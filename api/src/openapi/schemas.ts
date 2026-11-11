import {
  accommodationBedSchema,
  accommodationBedInputSchema,
  occupancySettingsSchema,
} from '@camping/contracts'
import { z } from 'zod'
import {
  addExtraSchema,
  appliedExtraSchema,
  availabilityOpenApiSchemas,
  campingProfileSchema,
  campingProfileUpdateSchema,
  checkInRequestSchema,
  closeRequestSchema,
  extraTemplateInputSchema,
  extraTemplatePatchSchema,
  extraTemplateSchema,
  loginSchema,
  paymentInputSchema,
  quoteRequestSchema,
  ratesSchema,
  moneySettingsSchema,
  reservationOpenApiSchemas,
  sessionUserSchema,
  stayPageSchema,
  stayQuoteSchema,
  staySchema,
  updateExtraSchema,
} from '@camping/contracts'
import type { ReferenceObject, SchemaObject } from '@nestjs/swagger'

export type OpenApiSchema = SchemaObject | ReferenceObject

/**
 * Keep OpenAPI request schemas derived from the same Zod contracts that parse
 * requests. `io: input` is required for check-in because its transform is an
 * implementation detail of the canonical contract, not part of the payload.
 * The default `unrepresentable: throw` deliberately rejects silent `{}` any
 * schemas when a contract cannot be described faithfully.
 */
export function zodOpenApiSchema(
  schema: z.ZodType,
  io: 'input' | 'output' = 'output',
): SchemaObject {
  return z.toJSONSchema(schema, {
    target: 'openapi-3.0',
    io,
    reused: 'inline',
    cycles: 'ref',
  }) as SchemaObject
}

export function openApiRef(name: string): ReferenceObject {
  return { $ref: `#/components/schemas/${name}` }
}

export function openApiArrayRef(name: string): SchemaObject {
  return { type: 'array', items: openApiRef(name) }
}

function componentName(key: string): string {
  return `${key.slice(0, 1).toUpperCase()}${key.slice(1)}`
}

const errorFieldSchema: SchemaObject = {
  type: 'object',
  properties: {
    path: { type: 'array', items: { type: 'string' } },
    message: { type: 'string' },
  },
  required: ['path', 'message'],
  additionalProperties: false,
}

export const openApiSchemas: Record<string, SchemaObject> = {
  AccommodationBed: zodOpenApiSchema(accommodationBedSchema),
  AccommodationBedInput: zodOpenApiSchema(accommodationBedInputSchema),
  OccupancySettings: zodOpenApiSchema(occupancySettingsSchema),
  Error: {
    type: 'object',
    properties: {
      code: { type: 'string', example: 'VALIDATION_ERROR' },
      message: {
        oneOf: [
          { type: 'string' },
          { type: 'array', items: { type: 'string' } },
        ],
      },
      statusCode: { type: 'integer' },
      error: { type: 'string' },
      fields: { type: 'array', items: errorFieldSchema },
    },
    required: ['message'],
    additionalProperties: false,
  },
  LoginRequest: zodOpenApiSchema(loginSchema, 'input'),
  SessionUser: zodOpenApiSchema(sessionUserSchema),
  CampingProfile: zodOpenApiSchema(campingProfileSchema),
  Rates: zodOpenApiSchema(ratesSchema, 'input'),
  CampingProfileUpdate: zodOpenApiSchema(campingProfileUpdateSchema, 'input'),
  MoneySettings: zodOpenApiSchema(moneySettingsSchema, 'input'),
  CheckInRequest: zodOpenApiSchema(checkInRequestSchema, 'input'),
  Stay: zodOpenApiSchema(staySchema),
  StayPage: zodOpenApiSchema(stayPageSchema),
  StayQuote: zodOpenApiSchema(stayQuoteSchema),
  QuoteRequest: zodOpenApiSchema(quoteRequestSchema, 'input'),
  CloseRequest: zodOpenApiSchema(closeRequestSchema, 'input'),
  PaymentInput: zodOpenApiSchema(paymentInputSchema, 'input'),
  ExtraTemplate: zodOpenApiSchema(extraTemplateSchema),
  ExtraTemplateInput: zodOpenApiSchema(extraTemplateInputSchema, 'input'),
  ExtraTemplatePatch: zodOpenApiSchema(extraTemplatePatchSchema, 'input'),
  AddExtra: zodOpenApiSchema(addExtraSchema, 'input'),
  UpdateExtra: zodOpenApiSchema(updateExtraSchema, 'input'),
  AppliedExtra: zodOpenApiSchema(appliedExtraSchema),
}

for (const [name, schema] of Object.entries(reservationOpenApiSchemas)) {
  openApiSchemas[componentName(name)] = zodOpenApiSchema(
    schema,
    name === 'reservationListQuery' ||
      name === 'reservationCheckInQuote' ||
      name === 'reservationCheckIn'
      ? 'input'
      : 'output',
  )
}

for (const [name, schema] of Object.entries(availabilityOpenApiSchemas)) {
  openApiSchemas[componentName(name)] = zodOpenApiSchema(
    schema,
    name === 'availabilityQuery' ? 'input' : 'output',
  )
}
