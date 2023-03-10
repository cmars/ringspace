/* eslint-disable @typescript-eslint/no-explicit-any */
import * as http from 'http';

/* eslint-disable node/no-unpublished-import */
import * as express from 'express';
import * as supertest from 'supertest';
import {v4} from 'uuid';

import * as automerge from '@automerge/automerge';

import {Controller} from 'ringspace/controller';
import {router} from 'ringspace/router';
import {SqliteDB} from 'ringspace/storage/db';
import {toAutomerge} from 'ringspace/actors';
import {PolicyStore} from 'ringspace/storage/policy';
import {testPolicyStore} from 'testutil/policy';

describe('changes', () => {
  let app: express.Application;
  let server: http.Server;
  let db: SqliteDB;
  let policyStore: PolicyStore;
  let actor_id: string;
  let doc: automerge.Doc<any>;
  let doc_id: string;
  let token: string;

  beforeEach(async () => {
    app = express();
    db = new SqliteDB(':memory:');
    policyStore = await testPolicyStore();
    await db.init();
    const controller = new Controller(db, policyStore);
    const r = router(controller);
    app.use(r);
    server = app.listen(0);

    actor_id = v4();
    doc = automerge.from(
      {
        nestedObject: {
          subObject: {
            someKey: 'someValue',
            someOtherKey: 42,
          },
        },
      },
      toAutomerge(actor_id)
    );

    const changes = automerge
      .getAllChanges(doc)
      .map(arr => Buffer.of(...arr).toString('base64'));

    const createDocResp = await supertest(app)
      .post('/docs')
      .send({
        data: {
          type: 'docs',
          attributes: {
            actor_id: actor_id,
            changes: changes,
            policy_id: 'allow-all',
          },
        },
      })
      .expect(201);
    const createDocAttrs = createDocResp.body?.data?.attributes;
    expect(createDocAttrs).toBeTruthy();
    expect(createDocResp.body.data.id).toBeTruthy();
    expect(createDocAttrs.token).toBeTruthy();
    expect(createDocAttrs.next_offset).toEqual(2);
    doc_id = createDocResp.body.data.id;
    token = createDocAttrs.token;
  });

  afterEach(async () => {
    server.close();
    await db.close();
  });

  it('can append changes to a doc', async () => {
    const newDoc = automerge.change(doc, (modifyDoc: any) => {
      modifyDoc.hello = 'world';
    });
    const changes = automerge.getChanges(doc, newDoc);
    const appendResp: supertest.Response = await supertest(app)
      .post(`/docs/${doc_id}/changes`)
      .set({authorization: `Bearer ${token}`})
      .send({
        data: {
          type: 'changes',
          attributes: {
            changes: changes.map(ch => Buffer.of(...ch).toString('base64')),
          },
        },
      })
      .expect(200);
    expect(appendResp.body.meta).toEqual({
      changes_added: 1,
      next_offset: 3,
    });
  });

  it('can request changes to a doc', async () => {
    const newDoc = automerge.change(doc, (modifyDoc: any) => {
      modifyDoc.hello = 'world';
    });
    const changes = automerge.getChanges(doc, newDoc);
    const appendResp: supertest.Response = await supertest(app)
      .post(`/docs/${doc_id}/changes`)
      .set({authorization: `Bearer ${token}`})
      .send({
        data: {
          type: 'changes',
          attributes: {
            changes: changes.map(ch => Buffer.of(...ch).toString('base64')),
          },
        },
      })
      .expect(200);
    expect(appendResp.body.meta).toEqual({
      changes_added: 1,
      next_offset: 3,
    });

    // Change offsets start at 1, so there will be 2 changes:
    // - the initial document
    // - the hello world change above
    const getRespFromBeginning: supertest.Response = await supertest(app)
      .get(`/docs/${doc_id}/changes?offset=0`)
      .set({authorization: `Bearer ${token}`})
      .expect(200);
    expect(getRespFromBeginning.body.data?.attributes?.changes).toHaveLength(2);
    expect(getRespFromBeginning.body.data?.attributes?.next_offset).toEqual(3);

    // Change offset is inclusive, so starting at 2, we'll get the hello world
    // change only.
    const getRespWithHelloWorld: supertest.Response = await supertest(app)
      .get(`/docs/${doc_id}/changes?offset=2`)
      .set({authorization: `Bearer ${token}`})
      .expect(200);
    expect(getRespWithHelloWorld.body.data?.attributes?.changes).toHaveLength(
      1
    );
    expect(getRespWithHelloWorld.body.data?.attributes?.next_offset).toEqual(3);

    const getRespNothingYet: supertest.Response = await supertest(app)
      .get(`/docs/${doc_id}/changes?offset=3`)
      .set({authorization: `Bearer ${token}`})
      .expect(200);
    expect(getRespNothingYet.body.data?.attributes?.changes).toHaveLength(0);
    expect(getRespNothingYet.body.data?.attributes?.next_offset).toEqual(3);

    // Automerge is of course idempotent
    const [updatedDoc] = automerge.applyChanges(
      newDoc,
      getRespFromBeginning.body.data.attributes.changes.map((ch: string) =>
        Buffer.from(ch, 'base64')
      )
    );
    expect(updatedDoc).toEqual(newDoc);
  });

  it('responds 401 when missing authorization', async () => {
    const newDoc = automerge.change(doc, (modifyDoc: any) => {
      modifyDoc.hello = 'world';
    });
    const changes = automerge.getChanges(doc, newDoc);
    await supertest(app)
      .post(`/docs/${doc_id}/changes`)
      .send({
        data: {
          type: 'changes',
          attributes: {
            changes: changes.map(ch => Buffer.of(...ch).toString('base64')),
          },
        },
      })
      .expect(401);
  });

  it('responds 403 when authorization invalid', async () => {
    const newDoc = automerge.change(doc, (modifyDoc: any) => {
      modifyDoc.hello = 'world';
    });
    const changes = automerge.getChanges(doc, newDoc);
    await supertest(app)
      .post(`/docs/${doc_id}/changes`)
      .set({authorization: 'Bearer nope'})
      .send({
        data: {
          type: 'changes',
          attributes: {
            changes: changes.map(ch => Buffer.of(...ch).toString('base64')),
          },
        },
      })
      .expect(403);
  });
});
