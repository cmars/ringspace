import * as path from 'path';

import {knex, Knex} from 'knex';
import {v4} from 'uuid';

import {NotFoundError} from 'ringspace/errors';

export interface DB {
  getActorIdForToken(
    authToken: string
  ): Promise<{doc_id: string; actor_id: string} | null>;

  appendChanges(
    doc_id: string,
    actor_id: string,
    changes: Buffer[]
  ): Promise<{nextOffset: number}>;

  getChanges(
    doc_id: string,
    offset: number
  ): Promise<{changes: Buffer[]; nextOffset: number}>;

  createDoc(params: {
    actor_id: string;
    changes: Buffer[];
    policy_id?: string;
  }): Promise<{
    doc_id: string;
    actor_id: string;
    token: string;
    nextOffset: number;
  }>;

  createInvite(
    doc_id: string,
    actor_id: string,
    roles: string[],
    note?: string
  ): Promise<{
    id: string;
    roles: string[];
    note?: string;
    uses_remaining: number;
  }>;

  consumeInvite(
    doc_id: string,
    invite_id: string,
    new_actor_id: string
  ): Promise<{token: string; uses_remaining: number}>;
}

export class SqliteDB implements DB {
  db: Knex;

  // TODO: use env var for dbfile
  constructor(dbfile = path.join(__dirname, '..', '..', 'ringspace.db')) {
    const db = knex({
      client: 'sqlite3',
      connection: {
        filename: dbfile,
      },
      useNullAsDefault: true,
    });
    this.db = db;
  }

  public async getActorIdForToken(
    authToken: string
  ): Promise<{doc_id: string; actor_id: string} | null> {
    const row = await this.db('actors')
      .select('doc_id', 'actor_id')
      .where({token: authToken})
      .first();
    if (!row) {
      return null;
    }
    return {doc_id: row.doc_id, actor_id: row.actor_id};
  }

  public async appendChanges(
    doc_id: string,
    actor_id: string,
    changes: Buffer[]
  ): Promise<{nextOffset: number}> {
    return await this.db.transaction(async tx => {
      await tx('changes').insert(
        changes.map(change => {
          return {
            doc_id,
            actor_id,
            change,
          };
        })
      );
      const maxOffsetRow = await tx('changes')
        .max('offset', {as: 'maxOffset'})
        .where({doc_id})
        .first();
      return {nextOffset: (maxOffsetRow?.maxOffset ?? 0) + 1};
    });
  }

  public async getChanges(
    doc_id: string,
    offset: number
  ): Promise<{changes: Buffer[]; nextOffset: number}> {
    return await this.db.transaction(async tx => {
      const changeRows = await tx('changes')
        .select('change')
        .where({doc_id})
        .where('offset', '>=', offset);
      const changes = changeRows.map(row => row.change);
      const maxOffsetRow = await tx('changes')
        .max('offset', {as: 'maxOffset'})
        .where({doc_id})
        .first();
      return {changes, nextOffset: (maxOffsetRow?.maxOffset ?? 0) + 1};
    });
  }

  public async createDoc(params: {
    actor_id: string;
    changes: Buffer[];
    policy_id: string;
  }): Promise<{
    doc_id: string;
    actor_id: string;
    token: string;
    nextOffset: number;
  }> {
    const docRow = {
      doc_id: v4(),
      policy_id: params.policy_id,
    };
    const actorRow = {
      doc_id: docRow.doc_id,
      actor_id: params.actor_id,
      roles: JSON.stringify(['admin']),
      token: v4(),
    };
    const changeRows = params.changes.map((buf: Buffer) => {
      return {
        doc_id: docRow.doc_id,
        actor_id: actorRow.actor_id,
        change: buf,
        created_at: new Date().toISOString(),
      };
    });
    return await this.db.transaction(async tx => {
      await tx('docs').insert(docRow);
      await tx('actors').insert(actorRow);
      await tx('changes').insert(changeRows);
      const maxOffsetRow = await tx('changes')
        .max('offset', {as: 'maxOffset'})
        .where({doc_id: docRow.doc_id})
        .first();
      return {
        doc_id: docRow.doc_id,
        actor_id: actorRow.actor_id,
        token: actorRow.token,
        nextOffset: (maxOffsetRow?.maxOffset ?? 0) + 1,
      };
    });
  }

  public async createInvite(
    doc_id: string,
    actor_id: string,
    roles: string[],
    note?: string | undefined
  ): Promise<{
    id: string;
    roles: string[];
    note?: string | undefined;
    uses_remaining: number;
  }> {
    const inviteRow = {
      doc_id,
      invite_id: v4(),
      roles: JSON.stringify(roles),
      note: note,
      created_at: new Date().toISOString(),
      created_by: actor_id,
      uses_remaining: 1,
    };
    await this.db.transaction(async tx => {
      await tx('invites').insert(inviteRow);
    });
    return {
      id: inviteRow.invite_id,
      roles: roles,
      note: inviteRow.note,
      uses_remaining: inviteRow.uses_remaining,
    };
  }

  public async consumeInvite(
    doc_id: string,
    invite_id: string,
    new_actor_id: string
  ): Promise<{token: string; uses_remaining: number}> {
    return await this.db.transaction(async tx => {
      const matchingInvite = await tx('invites')
        .select('uses_remaining', 'roles')
        .where({doc_id, invite_id})
        .where('uses_remaining', '>', 0)
        .first();
      if (!matchingInvite) {
        throw new NotFoundError();
      }
      const {uses_remaining, roles} = matchingInvite;
      const update_uses_remaining = uses_remaining - 1;
      await tx('invites')
        .where({doc_id, invite_id})
        .update({uses_remaining: update_uses_remaining});

      const actorRow = {
        doc_id,
        actor_id: new_actor_id,
        roles,
        token: v4(),
      };
      await tx('actors').insert(actorRow);

      return {token: actorRow.token, uses_remaining: update_uses_remaining};
    });
  }

  public async init(): Promise<void> {
    if (!(await this.db.schema.hasTable('docs'))) {
      await this.db.schema.createTable('docs', table => {
        table.primary(['doc_id']);
        table.uuid('doc_id').notNullable();
        table.string('policy_id').notNullable();
        // What do we want to say about a doc?
      });
    }
    if (!(await this.db.schema.hasTable('actors'))) {
      await this.db.schema.createTable('actors', table => {
        table.primary(['doc_id', 'actor_id']);
        table.uuid('doc_id').notNullable().references('docs.doc_id');
        table.uuid('actor_id').notNullable();
        table.string('token').notNullable();
        table.json('roles').notNullable();
      });
    }
    if (!(await this.db.schema.hasTable('changes'))) {
      await this.db.schema.createTable('changes', table => {
        table.primary(['doc_id', 'actor_id', 'offset']);
        table.increments('offset').notNullable();
        table.uuid('doc_id').notNullable().references('docs.doc_id');
        table.uuid('actor_id').notNullable().references('actors.actor_id');
        table
          .timestamp('created_at', {useTz: true})
          .defaultTo(this.db.fn.now())
          .notNullable();
        table.binary('change').notNullable();
      });
    }
    if (!(await this.db.schema.hasTable('invites'))) {
      await this.db.schema.createTable('invites', table => {
        table.primary(['doc_id', 'invite_id']);
        table.uuid('doc_id').notNullable().references('docs.doc_id');
        table.uuid('invite_id').notNullable();
        table.json('roles').notNullable();
        table.string('note').nullable();
        table.tinyint('uses_remaining').notNullable();
        table
          .timestamp('created_at', {useTz: true})
          .defaultTo(this.db.fn.now())
          .notNullable();
        table.uuid('created_by').notNullable().references('actors.actor_id');
      });
    }
  }

  public async close(): Promise<void> {
    await this.db.destroy();
  }
}
