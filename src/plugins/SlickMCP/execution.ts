import type { OperationScope } from './tools.ts';

export function executionScript(action: string, args: Record<string, unknown>, scope?: OperationScope) {
  const payload = JSON.stringify({ action, args, scope }).replace(/[<>\u2028\u2029]/g, (character) => {
    switch (character) {
      case '<':
        return '\\u003c';
      case '>':
        return '\\u003e';
      case '\u2028':
        return '\\u2028';
      default:
        return '\\u2029';
    }
  });
  return `(async()=>{
    const {action,args,scope}=${payload};
    const plugin=window.__slickPluginManager?.plugins.get('SlickMCP')?.instance;
    if(!plugin||!plugin.api.isActive())throw Error('Slick MCP is not ready in this workspace');
    if(scope){
      const context=await plugin.run('context',{});
      if(context.workspace_id!==scope.workspace_id||context.user_id!==scope.user_id)
        throw Error('Workspace changed before the operation could run');
    }
    return await plugin.run(action,args);
  })()`;
}
