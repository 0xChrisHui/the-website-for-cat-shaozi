import test from 'node:test';
import assert from 'node:assert/strict';
import { openForge } from './batch-io.mjs';


const tip='a'.repeat(40);
const stale='b'.repeat(40);
const repository='fixture/check';
const slug='repos/{owner}/{repo}';
const primary=105;
const publisher=106;
const expected=(outcome)=>({sha:tip,outcome,workflowRun:primary});
const job=(name,conclusion='success',head_sha=tip,status='completed')=>({name,conclusion,head_sha,status});
const run=(outcome='success',head_sha=tip,status='completed',id=primary)=>({id,head_sha,status,conclusion:outcome,event:'deployment_status',head_branch:'integration'});

function probe({runs, jobs, statuses, publish, artifacts, outcome='success'}={}){
 const sources=runs??[run(outcome)];
 const taskStates=jobs??[job('deploy'),job('browser',outcome)];
 const recorded=statuses??[{state:outcome,context:'e2e',creator:{login:'github-actions[bot]'},target_url:'https://github.com/'+repository+'/actions/runs/'+publisher}];
 const workflow=publish??{path:'.github/workflows/e2e-status.yml',repository:{full_name:repository},event:'workflow_run',status:'completed',conclusion:outcome};
 const recordedArtifacts=artifacts??[{name:'e2e-'+tip,expired:false}];
 const answers=new Map([
  [slug+'/actions/workflows/e2e.yml/runs',[{workflow_runs:sources}]],
  [slug+'/actions/runs/'+primary+'/jobs?filter=latest',[{jobs:taskStates}]],
  [slug+'/commits/'+tip+'/statuses?per_page=100',[recorded]],
  [slug+'/actions/runs/'+publisher,workflow],
  [slug+'/actions/runs/'+publisher+'/artifacts?per_page=100',[{artifacts:recordedArtifacts}]],
 ]);
 const invoke=(command,args)=>{
  if(command==='git'){
   if(args[0]==='rev-parse') return tip;
   if(['fetch','merge-base'].includes(args[0])) return '';
  }
  assert.equal(command,'gh');
  assert.equal(args[0],'api');
  assert.ok(answers.has(args[1]),'Unexpected request '+args[1]);
  return JSON.stringify(answers.get(args[1]));
 };
 return openForge('/fixture',invoke).integrationProof([tip]).fullE2e;
}

test('green is accepted only after deploy and browser complete and the exact trusted status is published',()=>{
 assert.deepEqual(probe(),expected('green'));
 assert.equal(probe({statuses:[]}),null);
 assert.equal(probe({jobs:[job('deploy'),job('browser','success',tip,'in_progress')]}),null);
});
test('the checked deployment can report a browser failure for repair',()=>{
 assert.deepEqual(probe({outcome:'failure'}),expected('red'));
 assert.equal(probe({outcome:'failure',jobs:[job('deploy','failure'),job('browser','skipped')]}),null);
});
test('stale and ambiguous evidence cannot unblock a newer exact integration head',()=>{
 assert.equal(probe({runs:[run('success',stale)]}),null);
 assert.equal(probe({jobs:[job('deploy'),job('browser'),job('browser')]}),null);
 assert.equal(probe({runs:[run('success',tip,'completed'),run(null,tip,'in_progress',primary+1)]}),null);
 assert.equal(probe({artifacts:[{name:'e2e-'+stale,expired:false}]}),null);
 assert.equal(probe({artifacts:[{name:'e2e-'+tip,expired:true}]}),null);
});
test('only the repository workflow and published source can provide a usable result',()=>{
 assert.equal(probe({statuses:[{state:'success',context:'e2e',creator:{login:'untrusted'},target_url:'https://github.com/'+repository+'/actions/runs/'+publisher}]}),null);
 assert.equal(probe({publish:{path:'.github/workflows/test.yml',event:'workflow_run',repository:{full_name:repository},status:'completed',conclusion:'success'}}),null);
 assert.equal(probe({publish:{path:'.github/workflows/e2e-status.yml',event:'workflow_run',repository:{full_name:'other/check'},status:'completed',conclusion:'success'}}),null);
});