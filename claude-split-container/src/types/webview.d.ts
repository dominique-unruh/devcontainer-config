declare module "webview" {
  import type { ChildProcess, SpawnOptionsWithoutStdio } from "node:child_process";

  export interface WebviewOptions extends SpawnOptionsWithoutStdio {
    url?: string;
    title?: string;
    width?: number;
    height?: number;
    dir?: string;
  }

  interface WebviewModule {
    binaryPath: string;
    optionsToArgv: (options: WebviewOptions) => string[];
    spawn: (options: WebviewOptions) => ChildProcess;
  }

  const webview: WebviewModule;
  export default webview;
}
