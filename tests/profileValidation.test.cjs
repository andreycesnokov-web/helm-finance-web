const test=require('node:test'),assert=require('node:assert/strict');
const{validTimezone,ownAvatarPath}=require('../server/lib/profileValidation');
const base='https://stage.example.invalid',file='00112233-4455-6677-8899-aabbccddeeff.png',own=base+'/storage/v1/object/public/avatars/-42/'+file;
test('timezones use real IANA validation rather than accepting arbitrary slash strings',()=>{
 for(const value of ['', 'UTC','Asia/Shanghai','Asia/Jakarta','Europe/Moscow'])assert.equal(validTimezone(value),true);
 for(const value of ['Not/AZone','Asia/NoCity','UTC<script>',123,null,'A'.repeat(65)])assert.equal(validTimezone(value),false);
});
test('photo URL must be our exact origin and current BIGINT actor folder',()=>{
 assert.deepEqual(ownAvatarPath(own,'-42',base),{path:'-42/'+file,mime:'image/png'});
 for(const value of [own.replace(base,'https://foreign.example.invalid'),own.replace('/-42/','/-43/'),own+'?token=secret',own+'#fragment',own.replace(file,'../../-43/'+file),base+'@foreign.example.invalid/storage/v1/object/public/avatars/-42/'+file,own.replace(file,'not-uuid.png')])assert.equal(ownAvatarPath(value,'-42',base),null);
 assert.equal(ownAvatarPath(own,'not-an-actor',base),null);
});
