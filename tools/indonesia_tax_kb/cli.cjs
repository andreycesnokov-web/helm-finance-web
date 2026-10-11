'use strict';
const {retrieve} = require('../../server/lib/indonesiaTaxKnowledge.cjs');
const args = process.argv.slice(2);
const get = key => {const i=args.indexOf('--'+key);return i<0?undefined:args[i+1];};
try {
  console.log(JSON.stringify(retrieve({question:get('question'),language:get('language')||'en',period:get('period'),company:get('company')?JSON.parse(get('company')):{}}),null,2));
} catch(e) {console.error(e.message);process.exitCode=1;}
