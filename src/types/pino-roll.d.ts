declare module "pino-roll" {
  export default function pinoRoll(options: {
    file: string;
    frequency?: string;
    size?: string;
    mkdir?: boolean;
  }): any;
}
