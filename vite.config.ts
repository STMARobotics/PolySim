import {defineConfig} from 'vite';
export default defineConfig(({mode})=>({
    plugins:[{name:'polysim-entry',transformIndexHtml:{order:'pre',handler(html) {return html.replace('/ui/main.ts',mode==='offline'?'/ui/main.ts':'/ui/bootstrap.ts');}}}],
    build:{outDir:mode==='offline'?'dist-offline':'dist'},
    server:{host:'127.0.0.1',proxy:{'/api':{target:'http://127.0.0.1:3000'}}},
}));
