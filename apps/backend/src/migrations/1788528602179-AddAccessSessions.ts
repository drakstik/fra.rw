import type { MigrationInterface, QueryRunner } from "typeorm";

export class AddAccessSessions1788528602179 implements MigrationInterface {
    name = 'AddAccessSessions1788528602179'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`CREATE TABLE "access_sessions" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "user_id" uuid NOT NULL, "token_hash" character(64) NOT NULL, "family_id" uuid NOT NULL, "expires_at" TIMESTAMP WITH TIME ZONE NOT NULL, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_c9607f8f85c9c129dc6a1159b0c" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE INDEX "IDX_access_sessions_user_id" ON "access_sessions"  ("user_id") `);
        await queryRunner.query(`CREATE UNIQUE INDEX "UQ_access_sessions_token_hash" ON "access_sessions"  ("token_hash") `);
        await queryRunner.query(`CREATE INDEX "IDX_access_sessions_family_id" ON "access_sessions"  ("family_id") `);
        await queryRunner.query(`ALTER TABLE "access_sessions" ADD CONSTRAINT "FK_3f67150796271348107eb7a4786" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "access_sessions" DROP CONSTRAINT "FK_3f67150796271348107eb7a4786"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_access_sessions_family_id"`);
        await queryRunner.query(`DROP INDEX "public"."UQ_access_sessions_token_hash"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_access_sessions_user_id"`);
        await queryRunner.query(`DROP TABLE "access_sessions"`);
    }

}
