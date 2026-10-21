// Exact baseline frontend blobs for before/after visual comparison, no checkout edits.
import {execFileSync} from 'node:child_process'
import path from 'node:path'
import baseConfig from '../../../client/vite.config.js'
const baseline='a55876d09103fc888b42935b4bd801074089efaf'
const git=process.env.GIT_EXE||'C:/Users/HUAWEI/.cache/codex-runtimes/codex-primary-runtime/dependencies/native/git/cmd/git.exe'
const files=['client/src/v2/pages/Performance.jsx','client/src/v2/charts/BarChart.jsx']
const originals=new Map(files.map(f=>[path.resolve(f).replaceAll('\\','/'),execFileSync(git,['show',baseline+':'+f],{encoding:'utf8'})]))
export default {...baseConfig,plugins:[{name:'baseline-performance-before',enforce:'pre',load(id){return originals.get(id.replaceAll('\\','/'))||null}},...baseConfig.plugins],build:{outDir:path.resolve('reports/interactive-pnl-20261021/before-dist'),emptyOutDir:true}}
