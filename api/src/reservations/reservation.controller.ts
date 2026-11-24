import {
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common'
import { ApiCookieAuth, ApiParam, ApiQuery, ApiTags } from '@nestjs/swagger'
import { AuthGuard } from '../auth/auth.guard'
import type { AuthenticatedRequest } from '../auth/auth.types'
import { assertAllowedOrigin } from '../common/security'
import { ApiEndpoint } from '../openapi/decorators'
import { openApiRef } from '../openapi/schemas'
import { ReservationService } from './reservation.service'
import { ReservationCheckInService } from './reservation-checkin.service'

@Controller('api/reservations')
@UseGuards(AuthGuard)
@ApiTags('reservations')
@ApiCookieAuth('camping_session')
export class ReservationController {
  constructor(
    private readonly reservationService: ReservationService,
    private readonly reservationCheckInService: ReservationCheckInService,
  ) {}

  @Post('search')
  @ApiEndpoint({
    operationId: 'reservationSearch',
    summary: 'Buscar alojamientos disponibles con sus precios',
    status: 201,
    body: openApiRef('ReservationSearch'),
    response: openApiRef('ReservationSearchResponse'),
    errors: [400, 401, 403, 413, 500],
  })
  search(@Req() request: AuthenticatedRequest) {
    assertAllowedOrigin(request)
    return this.reservationService.search(request.auth!, request.body)
  }

  @Post('quote')
  @ApiEndpoint({
    operationId: 'reservationQuoteCreate',
    summary: 'Cotizar una reserva',
    status: 201,
    body: openApiRef('ReservationQuoteCreate'),
    response: openApiRef('ReservationQuote'),
    errors: [400, 401, 403, 404, 409, 413, 500],
  })
  quote(@Req() request: AuthenticatedRequest) {
    assertAllowedOrigin(request)
    return this.reservationService.quote(request.auth!, request.body)
  }

  @Post()
  @ApiEndpoint({
    operationId: 'reservationCreate',
    summary: 'Crear una reserva confirmada',
    status: 201,
    body: openApiRef('ReservationCreate'),
    response: openApiRef('Reservation'),
    errors: [400, 401, 403, 404, 409, 413, 500],
  })
  create(@Req() request: AuthenticatedRequest) {
    assertAllowedOrigin(request)
    return this.reservationService.create(request.auth!, request.body)
  }

  @Get()
  @ApiEndpoint({
    operationId: 'reservationList',
    summary: 'Listar reservas',
    status: 200,
    response: openApiRef('ReservationPage'),
    errors: [400, 401, 404, 500],
  })
  @ApiQuery({
    name: 'status',
    required: false,
    enum: ['confirmed', 'checked_in', 'checked_out', 'cancelled', 'no_show'],
  })
  @ApiQuery({ name: 'typeId', required: false, format: 'uuid', type: String })
  @ApiQuery({
    name: 'checkInDate',
    required: false,
    format: 'date',
    type: String,
  })
  @ApiQuery({
    name: 'checkOutDate',
    required: false,
    format: 'date',
    type: String,
  })
  @ApiQuery({
    name: 'page',
    required: false,
    type: Number,
    minimum: 1,
    maximum: 2147483647,
    example: 1,
  })
  @ApiQuery({
    name: 'pageSize',
    required: false,
    type: Number,
    minimum: 1,
    maximum: 100,
    example: 25,
  })
  list(
    @Req() request: AuthenticatedRequest,
    @Query() query: Record<string, unknown>,
  ) {
    return this.reservationService.list(request.auth!, query)
  }

  @Get(':id')
  @ApiParam({ name: 'id', format: 'uuid', type: String })
  @ApiEndpoint({
    operationId: 'reservationRead',
    summary: 'Consultar una reserva',
    status: 200,
    response: openApiRef('Reservation'),
    errors: [400, 401, 404, 500],
  })
  get(
    @Req() request: AuthenticatedRequest,
    @Param('id', new ParseUUIDPipe()) id: string,
  ) {
    return this.reservationService.get(request.auth!, id)
  }

  @Post(':id/quote')
  @ApiParam({ name: 'id', format: 'uuid', type: String })
  @ApiEndpoint({
    operationId: 'reservationQuoteUpdate',
    summary: 'Cotizar cambios de una reserva',
    status: 201,
    body: openApiRef('ReservationQuoteUpdate'),
    response: openApiRef('ReservationUpdateQuote'),
    errors: [400, 401, 403, 404, 409, 413, 500],
  })
  quoteEdit(
    @Req() request: AuthenticatedRequest,
    @Param('id', new ParseUUIDPipe()) id: string,
  ) {
    assertAllowedOrigin(request)
    return this.reservationService.quoteEdit(request.auth!, id, request.body)
  }

  @Post(':id/check-in/quote')
  @ApiParam({ name: 'id', format: 'uuid', type: String })
  @ApiEndpoint({
    operationId: 'reservationCheckInQuote',
    summary: 'Cotizar el ingreso de una reserva',
    status: 201,
    body: openApiRef('ReservationCheckInQuote'),
    response: openApiRef('ReservationQuote'),
    errors: [400, 401, 403, 404, 409, 413, 500],
  })
  checkInQuote(
    @Req() request: AuthenticatedRequest,
    @Param('id', new ParseUUIDPipe()) id: string,
  ) {
    assertAllowedOrigin(request)
    return this.reservationCheckInService.quote(request.auth!, id, request.body)
  }

  @Post(':id/check-in')
  @ApiParam({ name: 'id', format: 'uuid', type: String })
  @ApiEndpoint({
    operationId: 'reservationCheckIn',
    summary: 'Ingresar una reserva',
    status: 201,
    body: openApiRef('ReservationCheckIn'),
    response: openApiRef('Reservation'),
    errors: [400, 401, 403, 404, 409, 413, 500],
  })
  checkIn(
    @Req() request: AuthenticatedRequest,
    @Param('id', new ParseUUIDPipe()) id: string,
  ) {
    assertAllowedOrigin(request)
    return this.reservationCheckInService.checkIn(
      request.auth!,
      id,
      request.body,
    )
  }

  @Patch(':id')
  @ApiParam({ name: 'id', format: 'uuid', type: String })
  @ApiEndpoint({
    operationId: 'reservationUpdate',
    summary: 'Modificar una reserva',
    status: 200,
    body: openApiRef('ReservationPatch'),
    response: openApiRef('Reservation'),
    errors: [400, 401, 403, 404, 409, 413, 500],
  })
  update(
    @Req() request: AuthenticatedRequest,
    @Param('id', new ParseUUIDPipe()) id: string,
  ) {
    assertAllowedOrigin(request)
    return this.reservationService.update(request.auth!, id, request.body)
  }

  @Post(':id/cancel')
  @ApiParam({ name: 'id', format: 'uuid', type: String })
  @ApiEndpoint({
    operationId: 'reservationCancel',
    summary: 'Cancelar una reserva',
    status: 201,
    body: openApiRef('ReservationStatusCommand'),
    response: openApiRef('Reservation'),
    errors: [400, 401, 403, 404, 409, 413, 500],
  })
  cancel(
    @Req() request: AuthenticatedRequest,
    @Param('id', new ParseUUIDPipe()) id: string,
  ) {
    assertAllowedOrigin(request)
    return this.reservationService.command(
      request.auth!,
      id,
      'cancel',
      request.body,
    )
  }

  @Post(':id/no-show')
  @ApiParam({ name: 'id', format: 'uuid', type: String })
  @ApiEndpoint({
    operationId: 'reservationNoShow',
    summary: 'Marcar una reserva como no presentada',
    status: 201,
    body: openApiRef('ReservationStatusCommand'),
    response: openApiRef('Reservation'),
    errors: [400, 401, 403, 404, 409, 413, 500],
  })
  noShow(
    @Req() request: AuthenticatedRequest,
    @Param('id', new ParseUUIDPipe()) id: string,
  ) {
    assertAllowedOrigin(request)
    return this.reservationService.command(
      request.auth!,
      id,
      'no-show',
      request.body,
    )
  }
}
