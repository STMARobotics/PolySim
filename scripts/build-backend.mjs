import {build} from 'esbuild';
for(const name of ['auth','robots','seasons'])await build({entryPoints:[`service/handlers/${name}.ts`],bundle:true,platform:'node',target:'node24',format:'cjs',outfile:`service-dist/${name}/index.js`,sourcemap:true,logLevel:'info'});
