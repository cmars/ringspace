import * as express from 'express';
import helmet from 'helmet';

import {Controller} from 'ringspace/controller';
import {router} from 'ringspace/router';
import {SqliteDB} from 'ringspace/storage/db';
import {FilePolicyStore} from './storage/policy';

const app = express();
const port = 3000;

app.use(helmet());
app.disable('x-powered-by');

const main = async () => {
  const storage = new SqliteDB();
  await storage.init();
  const policies = new FilePolicyStore({}); // TODO: configure meeee
  const controller = new Controller(storage, policies);
  const r = router(controller);
  app.use(r);

  app.listen(port, () => {
    console.log(`listening on port ${port}`);
  });
};

main();
