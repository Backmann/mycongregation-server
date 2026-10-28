import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { QueryServiceGroupsDto } from '../service-groups/dto/query-service-groups.dto';
import { QueryPublishersDto } from '../publishers/dto/query-publishers.dto';
import { QueryAssignmentDto } from '../assignments/dto/query-assignment.dto';

/**
 * As the validation pipe converts (main.ts): implicitly, before @Transform.
 * "false" used to arrive as true.
 */
const read = <T>(cls: new () => T, q: Record<string, string>) =>
  plainToInstance(cls, q, { enableImplicitConversion: true });

describe('a yes/no flag in the query string', () => {
  it.each([
    ['false', false],
    ['true', true],
    ['0', false],
    ['1', true],
  ])(
    '?includeRemoved=%s reads as %s (groups, publishers, assignments)',
    (raw, want) => {
      expect(
        read(QueryServiceGroupsDto, { includeRemoved: raw }).includeRemoved,
      ).toBe(want);
      expect(
        read(QueryPublishersDto, { includeRemoved: raw }).includeRemoved,
      ).toBe(want);
      expect(
        read(QueryAssignmentDto, { includeRemoved: raw }).includeRemoved,
      ).toBe(want);
    },
  );

  it('?isActive=false means the inactive ones', () => {
    expect(read(QueryPublishersDto, { isActive: 'false' }).isActive).toBe(
      false,
    );
  });

  it('absent stays absent, nonsense reads as absent', () => {
    expect(read(QueryServiceGroupsDto, {}).includeRemoved).toBeUndefined();
    expect(
      read(QueryServiceGroupsDto, { includeRemoved: 'maybe' }).includeRemoved,
    ).toBeUndefined();
  });
});
