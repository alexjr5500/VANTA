import {test} from 'node:test';
import assert from 'node:assert/strict';
import {pingProvider, checkDatabase, runProbe} from './acceptance-provider-probe.mjs';
const env = {CLOUDINARY_CLOUD_NAME:'fixture', CLOUDINARY_API_KEY:'fixture-key', CLOUDINARY_API_SECRET:'fixture-secret'};
test('authenticated provider ping uses exact HTTPS origin, read-only request and bounded response', async () => {
  const result = await pingProvider(env, async (url, init) => {
    assert.equal(url,'https://api.cloudinary.com/v1_1/fixture/ping');
    assert.equal(init.method,'GET');
    assert.equal(init.redirect,'error');
    assert.equal(init.headers.Authorization,'Basic '+Buffer.from('fixture-key:fixture-secret').toString('base64'));
    return new Response('{"status":"ok"}',{status:200});
  });
  assert.deepEqual(result,{passed:true,httpStatus:200});
});
test('provider errors and overlong responses do not leak credential or response values', async () => {
  assert.deepEqual(await pingProvider(env,async()=>new Response('fixture-secret',{status:401})),{passed:false,httpStatus:401});
  assert.deepEqual(await pingProvider(env,async()=>new Response('x'.repeat(4097))),{passed:false,reason:'response_limit'});
  assert.deepEqual(await pingProvider(env,async()=>{throw Error('fixture-secret')}),{passed:false,reason:'provider_request_failed'});
});
test('invalid account name is refused without traffic', async () => {
  let calls=0;
  assert.equal((await pingProvider({...env,CLOUDINARY_CLOUD_NAME:'../other'},async()=>{calls++;})).passed,false);
  assert.equal(calls,0);
});
test('database probe uses a read-only transaction and verifies required schema', async () => {
  const statements=[];
  let disconnected=false;
  const result=await checkDatabase({},()=>({
    $transaction: async fn=>fn({
      $executeRawUnsafe:async s=>{statements.push(s);},
      $queryRawUnsafe:async s=>{statements.push(s);return s.includes('pg_is_in_recovery')?[{standby:false,read_only:true}]:[{queue:true,derivatives:true,migrations:true}];}
    }),
    $disconnect:async()=>{disconnected=true;}
  }));
  assert.equal(statements[0],'SET TRANSACTION READ ONLY');
  assert.equal(result.passed,true);
  assert.equal(disconnected,true);
});
test('database errors and wrong scope fail closed', async () => {
  assert.deepEqual(await checkDatabase({},()=>{throw Error('private-connection-string')}),{passed:false,reason:'database_probe_failed'});
  let calls=0;
  assert.equal(await runProbe({},'worker',async()=>{calls++;},async()=>{calls++;}),10);
  assert.equal(calls,0);
});
