declare module "sa2kit/iflytek/server" {
  import type { Socket } from "socket.io";

  export interface IflytekServerAdapterOptions {
    appId: string;
    apiKey: string;
    apiSecret: string;
    debug?: boolean;
  }

  export class IflytekServerAdapter {
    constructor(options: IflytekServerAdapterOptions);
    attach(socket: Socket): void;
  }
}
