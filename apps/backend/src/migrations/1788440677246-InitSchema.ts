import type { MigrationInterface, QueryRunner } from "typeorm";

export class InitSchema1788440677246 implements MigrationInterface {
    name = 'InitSchema1788440677246'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`CREATE TABLE "users" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "email" citext NOT NULL, "phone_number" character varying(20) NOT NULL, "first_name" character varying(100) NOT NULL, "last_name" character varying(100) NOT NULL, "password_hash" character varying NOT NULL, "token_version" integer NOT NULL DEFAULT '0', "is_active" boolean NOT NULL DEFAULT true, "email_verified_at" TIMESTAMP WITH TIME ZONE, "failed_login_attempts" integer NOT NULL DEFAULT '0', "locked_until" TIMESTAMP WITH TIME ZONE, "last_login_at" TIMESTAMP WITH TIME ZONE, "password_changed_at" TIMESTAMP WITH TIME ZONE, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deleted_at" TIMESTAMP WITH TIME ZONE, "role" character varying NOT NULL, CONSTRAINT "PK_a3ffb1c0c8416b9fc6f907b7433" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE UNIQUE INDEX "UQ_users_phone_number_active" ON "users"  ("phone_number") WHERE "deleted_at" IS NULL`);
        await queryRunner.query(`CREATE UNIQUE INDEX "UQ_users_email_active" ON "users"  ("email") WHERE "deleted_at" IS NULL`);
        await queryRunner.query(`CREATE INDEX "IDX_ace513fa30d485cfd25c11a9e4" ON "users"  ("role") `);
        await queryRunner.query(`CREATE TABLE "refresh_tokens" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "user_id" uuid NOT NULL, "token_hash" character(64) NOT NULL, "family_id" uuid NOT NULL, "user_agent" character varying(512), "ip_address" inet, "expires_at" TIMESTAMP WITH TIME ZONE NOT NULL, "revoked_at" TIMESTAMP WITH TIME ZONE, "replaced_by_token_hash" character(64), "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_7d8bee0204106019488c4c50ffa" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE INDEX "IDX_refresh_tokens_user_id" ON "refresh_tokens"  ("user_id") `);
        await queryRunner.query(`CREATE UNIQUE INDEX "UQ_refresh_tokens_token_hash" ON "refresh_tokens"  ("token_hash") `);
        await queryRunner.query(`CREATE INDEX "IDX_refresh_tokens_family_id" ON "refresh_tokens"  ("family_id") `);
        await queryRunner.query(`ALTER TABLE "refresh_tokens" ADD CONSTRAINT "FK_3ddc983c5f7bcf132fd8732c3f4" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "refresh_tokens" DROP CONSTRAINT "FK_3ddc983c5f7bcf132fd8732c3f4"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_refresh_tokens_family_id"`);
        await queryRunner.query(`DROP INDEX "public"."UQ_refresh_tokens_token_hash"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_refresh_tokens_user_id"`);
        await queryRunner.query(`DROP TABLE "refresh_tokens"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_ace513fa30d485cfd25c11a9e4"`);
        await queryRunner.query(`DROP INDEX "public"."UQ_users_email_active"`);
        await queryRunner.query(`DROP INDEX "public"."UQ_users_phone_number_active"`);
        await queryRunner.query(`DROP TABLE "users"`);
    }

}
