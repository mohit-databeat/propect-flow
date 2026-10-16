import { z } from "zod";

export const PaginationQuery = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(25),
  sort: z
    .string()
    .regex(/^[a-zA-Z_.]+:(asc|desc)$/)
    .optional(),
});
export type PaginationQuery = z.infer<typeof PaginationQuery>;

export interface Paginated<T> {
  items: T[];
  page: number;
  pageSize: number;
  total: number;
}

export const IdParam = z.object({ id: z.string().uuid() });
