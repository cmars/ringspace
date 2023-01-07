/* eslint-disable @typescript-eslint/no-explicit-any */
import * as http from 'http';

import * as express from 'express';
/* eslint-disable node/no-unpublished-import */
import * as supertest from 'supertest';
import {v4} from 'uuid';

import * as automerge from '@automerge/automerge';

import {Controller} from 'ringspace/controller';
import {router} from 'ringspace/router';
import {SqliteDB} from 'ringspace/storage/db';
import {PolicyStore} from 'ringspace/storage/policy';
import {toAutomerge} from 'ringspace/actors';

import {testPolicyStore} from 'testutil/policy';

describe('create doc collaboration', () => {
  let app: express.Application;
  let server: http.Server;
  let db: SqliteDB;
  let policyStore: PolicyStore;

  beforeEach(async () => {
    app = express();
    db = new SqliteDB(':memory:');
    await db.init();
    policyStore = await testPolicyStore();
    const controller = new Controller(db, policyStore);
    const r = router(controller);
    app.use(r);
    server = app.listen(0);
  });

  afterEach(async () => {
    server.close();
    await db.close();
  });

  it('can create a doc collaboration', async () => {
    const actor_id = v4();
    const newDoc: automerge.Doc<any> = automerge.from(
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
      .getAllChanges(newDoc)
      .map(arr => Buffer.of(...arr).toString('base64'));

    const resp = await supertest(app)
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

    expect(resp.body.data?.id).toBeTruthy();
    expect(resp.body.data?.attributes?.token).toBeTruthy();
    expect(resp.body).toEqual(
      expect.objectContaining({
        data: expect.objectContaining({
          type: 'docs',
          attributes: expect.objectContaining({
            actor_id,
            next_offset: 2,
          }),
        }),
      })
    );

    expect(await db.db('docs').count()).toEqual([{'count(*)': 1}]);
  });

  it('responds bad request for wrong resource type', async () => {
    await supertest(app)
      .post('/docs')
      .send({
        data: {
          type: 'scod',
          attributes: {
            actor_id: v4(),
            changes: [],
            policy_id: 'allow-all',
          },
        },
      })
      .expect(400);
  });

  it('responds not found for missing policy', async () => {
    await supertest(app)
      .post('/scod')
      .send({
        data: {
          type: 'scod',
          attributes: {
            actor_id: v4(),
            changes: [],
          },
        },
      })
      .expect(404);
  });

  it('responds not found for unknown policy', async () => {
    await supertest(app)
      .post('/scod')
      .send({
        data: {
          type: 'scod',
          attributes: {
            actor_id: v4(),
            changes: [],
            policy_id: 'no-such-policy',
          },
        },
      })
      .expect(404);
  });

  it('responds not found for unsupported route', async () => {
    await supertest(app)
      .post('/scod')
      .send({
        data: {
          type: 'scod',
          attributes: {
            actor_id: v4(),
            changes: [],
            policy_id: 'allow-all',
          },
        },
      })
      .expect(404);
  });
});
