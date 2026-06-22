import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddTalkExchangeFreeTextSpeaker1812000000000 implements MigrationInterface {
  name = 'AddTalkExchangeFreeTextSpeaker1812000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "talk_exchange" ADD "speaker_name" text`,
    );
    await queryRunner.query(
      `ALTER TABLE "talk_exchange" ADD "speaker_congregation" text`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "talk_exchange" DROP COLUMN "speaker_congregation"`,
    );
    await queryRunner.query(
      `ALTER TABLE "talk_exchange" DROP COLUMN "speaker_name"`,
    );
  }
}
