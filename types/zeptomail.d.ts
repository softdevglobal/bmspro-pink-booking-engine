declare module "zeptomail" {
  export class SendMailClient {
    constructor(config: { url: string; token: string });
    sendMail(payload: Record<string, unknown>): Promise<unknown>;
  }
}
