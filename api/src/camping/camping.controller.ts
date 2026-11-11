import { Controller, Get, Patch, Req, UseGuards } from '@nestjs/common'
import { ApiCookieAuth, ApiTags } from '@nestjs/swagger'
import { AuthGuard } from '../auth/auth.guard'
import type { AuthenticatedRequest } from '../auth/auth.types'
import { assertAllowedOrigin } from '../common/security'
import { CampingService } from './camping.service'
import { ApiEndpoint } from '../openapi/decorators'
import { openApiRef } from '../openapi/schemas'

@Controller('api/camping')
@UseGuards(AuthGuard)
@ApiTags('camping')
@ApiCookieAuth('camping_session')
export class CampingController {
  constructor(private readonly campingService: CampingService) {}

  @Get()
  @ApiEndpoint({
    operationId: 'campingProfile',
    summary: 'Consultar el camping y su ocupación activa',
    status: 200,
    response: openApiRef('CampingProfile'),
    errors: [401, 404, 500],
  })
  profile(@Req() request: AuthenticatedRequest) {
    return this.campingService.profile(request.auth!)
  }

  @Patch()
  @ApiEndpoint({
    operationId: 'campingUpdateProfile',
    summary: 'Actualizar el nombre y la zona horaria del camping',
    status: 200,
    body: openApiRef('CampingProfileUpdate'),
    response: openApiRef('CampingProfile'),
    errors: [400, 401, 403, 404, 409, 413, 500],
  })
  updateProfile(@Req() request: AuthenticatedRequest) {
    assertAllowedOrigin(request)
    return this.campingService.updateProfile(request.auth!, request.body)
  }

  @Patch('occupancy-settings')
  @ApiEndpoint({
    operationId: 'campingUpdateOccupancySettings',
    summary: 'Configurar edades de huéspedes y ocupación de bebés',
    status: 200,
    body: openApiRef('OccupancySettings'),
    response: openApiRef('CampingProfile'),
    errors: [400, 401, 403, 404, 413, 500],
  })
  updateOccupancySettings(@Req() request: AuthenticatedRequest) {
    assertAllowedOrigin(request)
    return this.campingService.updateOccupancySettings(
      request.auth!,
      request.body,
    )
  }

  @Patch('money-settings')
  @ApiEndpoint({
    operationId: 'campingUpdateMoneySettings',
    summary: 'Configurar centavos para nuevas reservas y estadías',
    status: 200,
    body: openApiRef('MoneySettings'),
    response: openApiRef('CampingProfile'),
    errors: [400, 401, 403, 404, 413, 500],
  })
  updateMoneySettings(@Req() request: AuthenticatedRequest) {
    assertAllowedOrigin(request)
    return this.campingService.updateMoneySettings(request.auth!, request.body)
  }

  @Patch('rates')
  @ApiEndpoint({
    operationId: 'campingUpdateRates',
    summary: 'Actualizar tarifas para nuevos ingresos',
    status: 200,
    body: openApiRef('Rates'),
    response: openApiRef('CampingProfile'),
    errors: [400, 401, 403, 404, 413, 500],
  })
  updateRates(@Req() request: AuthenticatedRequest) {
    assertAllowedOrigin(request)
    return this.campingService.updateRates(request.auth!, request.body)
  }
}
