import * as fs from 'fs';

import {Policy} from 'authmerge';
import {loadPolicy} from '@open-policy-agent/opa-wasm';

import {NotFoundError} from 'ringspace/errors';

export interface PolicyStore {
  // TODO: versioning policies

  listPolicyIDs(): string[];
  getPolicy(policy_id: string): Policy;
}

export class FilePolicyStore implements PolicyStore {
  private files: Map<string, string>;
  private policies: Map<string, Policy>;

  constructor(files: {[policy_id: string]: string}) {
    this.files = new Map(Object.entries(files));
    this.policies = new Map<string, Policy>();
  }

  listPolicyIDs(): string[] {
    return [...this.policies.keys()];
  }

  getPolicy(policy_id: string): Policy {
    const policy = this.policies.get(policy_id);
    if (!policy) {
      throw new NotFoundError(`policy ${policy_id} not found`);
    }
    return policy;
  }

  async init(): Promise<void> {
    for (const [policy_id, policy_path] of this.files.entries()) {
      const wasmBuf = await fs.readFileSync(policy_path);
      const policy = await loadPolicy(wasmBuf);
      this.policies.set(policy_id, policy);
    }
  }
}
