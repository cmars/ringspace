import * as path from 'path';

import {FilePolicyStore, PolicyStore} from 'ringspace/storage/policy';

import {testPolicyPath} from './compile';

let loadedTestPolicyStore: PolicyStore | null = null;

export const testPolicyStore = async (): Promise<PolicyStore> => {
  if (loadedTestPolicyStore) {
    return loadedTestPolicyStore;
  }
  const store = new FilePolicyStore({
    'allow-all': path.join(testPolicyPath, 'allow-all.wasm'),
  });
  await store.init();
  loadedTestPolicyStore = store;
  return store;
};
