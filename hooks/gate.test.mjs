// The 5 to 9 — white-box unit tests for the Node irreversible gate.
// Zero dependencies; run with `node --test`. The 90-case behavioural corpus
// (tests/gate-cases.txt via tests/gate-test.sh) is the end-to-end oracle; these
// add fast in-process coverage of the classifier and the JSON-emit contract.
import test from 'node:test';
import assert from 'node:assert/strict';
import { firstDenySegment, extractCommand, denyDecision } from './irreversible-gate.mjs';

const DENY = [
  'git push --force', 'git push -f', 'git push -f origin main', 'git push -uf origin main',
  'git push origin +main', 'git -C /t push --force', 'git -c x=y push --force',
  'git push origin :old', 'git push origin --delete x', 'git push --mirror',
  'npm publish', 'pnpm publish', 'cargo publish', 'gem push p.gem', 'twine upload dist/*',
  'mvn deploy', 'gradle publish', 'dotnet nuget push x.nupkg',
  'gh release create v1', 'gh repo delete o/r', 'gh secret delete K',
  'docker push img', 'kubectl apply -f x', 'k apply -f x', 'kubectl rollout restart d/x',
  'helm upgrade w ./c', 'terraform apply', 'pulumi up', 'cdk deploy', 'wrangler deploy',
  'pm2 deploy prod', 'railway up', 'serverless deploy', 'netlify deploy', 'firebase deploy',
  'fly deploy', 'vercel --prod', 'vercel deploy', 'gcloud app deploy', 'heroku deploy',
  'npm run deploy', 'make deploy', 'ansible-playbook s.yml',
  'aws s3 rm s3://b/k', 'aws s3api delete-object --bucket b', 'aws ecr batch-delete-image --x',
  'aws rds delete-db-instance --x', 'aws secretsmanager delete-secret --x',
  'aws secretsmanager rotate-secret --x', 'vault kv delete secret/x',
  'supabase db reset', 'dropdb prod', 'drop database prod',
  'git add -A && git commit -m x && npm publish', 'sudo wrangler deploy',
];

const ALLOW = [
  'git push origin the-5-to-9/shift-20260614', 'git push -u origin HEAD',
  'git push --follow-tags', 'git push origin --tags', 'git push origin HEAD:refs/heads/feature',
  'git -C /t push origin my-shift-branch', "git commit -m 'push it real good'",
  'git checkout -b feature/x', 'git status', 'git add -A',
  'npm test', 'npm run build', 'npm install', 'make build', 'make test',
  'pytest -q', 'cargo test', 'go test ./...', 'aws s3 cp ./a s3://b/c',
  'gcloud auth login', 'gcloud config set project deploy-thing',
  'gcloud auth login && echo deploy-notes.txt', 'vercel link && npm run dev',
  'git push origin feature-deploy-button', 'bd ready --claim --json', 'ls -la',
  'docker build -t img .', 'kubectl get pods',
];

for (const c of DENY) {
  test(`deny: ${c}`, () => assert.ok(firstDenySegment(c) !== null, `expected DENY but allowed: ${c}`));
}
for (const c of ALLOW) {
  test(`allow: ${c}`, () => assert.equal(firstDenySegment(c), null, `expected ALLOW but denied: ${c}`));
}

test('emitted deny JSON stays valid for quotes + backslash + newline (the sed-bug class)', () => {
  const cmd = 'git push --force "weird \\back" \n second';
  const seg = firstDenySegment(cmd);
  assert.ok(seg, 'should flag the force-push');
  const out = JSON.stringify(denyDecision(seg));
  const parsed = JSON.parse(out); // must not throw
  assert.equal(parsed.hookSpecificOutput.hookEventName, 'PreToolUse');
  assert.equal(parsed.hookSpecificOutput.permissionDecision, 'deny');
});

test('extractCommand tolerates missing / non-JSON / nested input', () => {
  assert.equal(extractCommand(''), '');
  assert.equal(extractCommand('not json at all'), '');
  assert.equal(extractCommand('{"tool_input":{"command":"git status"}}'), 'git status');
  assert.equal(extractCommand('{"tool_input":{}}'), '');
});
