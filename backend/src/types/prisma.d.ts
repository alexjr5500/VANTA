declare module '@prisma/client' {
  export * from '@prisma/client/index';
}

declare module '@prisma/adapter-better-sqlite3' {
  import { PrismaAdapter } from '@prisma/client';
  export class PrismaBetterSqlite3 implements PrismaAdapter {
    constructor(options: { url: string });
  }
}

declare module '@prisma/adapter-pg' {
  import { PrismaAdapter } from '@prisma/client';
  export class PrismaPg implements PrismaAdapter {
    constructor(options: { url: string });
  }
}