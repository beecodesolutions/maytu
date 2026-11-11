import {
  accommodationBedSchema,
  type AccommodationTypeCreate,
  type AccommodationTypePatch,
  type AccommodationUnitCreate,
  type AccommodationUnitPatch,
} from '@camping/contracts'
import type { z } from 'zod'
import {
  createApi,
  fetchBaseQuery,
  type BaseQueryApi,
  type FetchArgs,
} from '@reduxjs/toolkit/query/react'
import {
  accommodationTypeSchema,
  accommodationUnitSchema,
  availabilityResponseSchema,
  campingProfileSchema,
  extraTemplateSchema,
  reservationPageSchema,
  reservationSearchResponseSchema,
  reservationQuoteSchema,
  reservationResponseSchema,
  sessionUserSchema,
  stayPageSchema,
  stayQuoteSchema,
  staySchema,
} from '@camping/contracts'
import type {
  AccommodationType,
  AccommodationUnit,
  AvailabilityQuery,
  AvailabilityResponse,
  CampingProfile,
  CampingProfileUpdate,
  OccupancySettings,
  CheckInRequest,
  ExtraTemplate,
  PaymentInput,
  ReservationCreate,
  ReservationSearch,
  ReservationSearchResponse,
  ReservationQuoteCreate,
  ReservationListQuery,
  ReservationPage,
  ReservationQuote,
  ReservationResponse,
  SessionUser,
  Stay,
  StayPage,
  StayQuote,
} from '@camping/contracts'
import type { ZodType } from 'zod'
export type { CampingProfile } from '@camping/contracts'

import type {
  LoginInput,
  ExtraTemplateInput,
  ExtraTemplatePatch,
  AddExtraInput,
  RateInput,
} from './types'

const rawBaseQuery = fetchBaseQuery({
  baseUrl: import.meta.env.VITE_API_URL || '/api',
  credentials: 'include',
})

const baseQuery = async (
  args: string | FetchArgs,
  api: BaseQueryApi,
  extra: Record<string, unknown>,
) => {
  const result = await rawBaseQuery(args, api, extra)
  if (
    result.error?.status === 401 &&
    api.endpoint !== 'session' &&
    api.endpoint !== 'login'
  ) {
    api.dispatch(apiSlice.util.resetApiState())
  }
  return result
}

const parse = <T>(schema: ZodType<T>, response: unknown): T =>
  schema.parse(response)
const createStayResponseSchema = sessionUserSchema.pick({ id: true })

export const apiSlice = createApi({
  reducerPath: 'api',
  tagTypes: [
    'Session',
    'Camping',
    'Stays',
    'Stay',
    'Templates',
    'Reservations',
    'Reservation',
    'Availability',
    'Accommodations',
  ],
  baseQuery,
  endpoints: (builder) => ({
    session: builder.query<SessionUser, void>({
      query: () => '/auth/session',
      transformResponse: (response) => parse(sessionUserSchema, response),
      providesTags: ['Session'],
    }),
    login: builder.mutation<SessionUser, LoginInput>({
      query: (body) => ({ url: '/auth/login', method: 'POST', body }),
      transformResponse: (response) => parse(sessionUserSchema, response),
      invalidatesTags: ['Session', 'Camping', 'Stays'],
    }),
    logout: builder.mutation<void, void>({
      query: () => ({ url: '/auth/logout', method: 'POST' }),
      async onQueryStarted(_, { dispatch, queryFulfilled }) {
        try {
          await queryFulfilled
          dispatch(apiSlice.util.resetApiState())
        } catch {
          /* keep the form available for retry */
        }
      },
      invalidatesTags: ['Session', 'Camping', 'Stays', 'Stay', 'Templates'],
    }),
    camping: builder.query<CampingProfile, void>({
      query: () => '/camping',
      transformResponse: (response) => parse(campingProfileSchema, response),
      providesTags: ['Camping'],
    }),
    accommodationTypes: builder.query<AccommodationType[], void>({
      query: () => '/accommodations/types',
      transformResponse: (response) =>
        parse(accommodationTypeSchema.array(), response),
      providesTags: ['Accommodations'],
    }),
    accommodationUnits: builder.query<
      AccommodationUnit[],
      { typeId?: string } | void
    >({
      query: (arg) =>
        arg?.typeId
          ? `/accommodations/units?typeId=${encodeURIComponent(arg.typeId)}`
          : '/accommodations/units',
      transformResponse: (response) =>
        parse(accommodationUnitSchema.array(), response),
      providesTags: ['Accommodations'],
    }),
    availability: builder.query<AvailabilityResponse, AvailabilityQuery>({
      query: ({ checkInDate, checkOutDate, typeId }) => {
        const params = new URLSearchParams({ checkInDate, checkOutDate })
        if (typeId) params.set('typeId', typeId)
        return `/availability?${params.toString()}`
      },
      transformResponse: (response) =>
        parse(availabilityResponseSchema, response),
      providesTags: ['Availability'],
    }),
    reservations: builder.query<ReservationPage, ReservationListQuery>({
      query: ({
        status,
        typeId,
        checkInDate,
        checkOutDate,
        page = 1,
        pageSize = 100,
      }) => {
        const params = new URLSearchParams({
          page: String(page),
          pageSize: String(pageSize),
        })
        if (status) params.set('status', status)
        if (typeId) params.set('typeId', typeId)
        if (checkInDate) params.set('checkInDate', checkInDate)
        if (checkOutDate) params.set('checkOutDate', checkOutDate)
        return `/reservations?${params.toString()}`
      },
      transformResponse: (response) => parse(reservationPageSchema, response),
      providesTags: (result) =>
        result
          ? [
              { type: 'Reservations', id: 'LIST' },
              ...result.items.map((reservation) => ({
                type: 'Reservation' as const,
                id: reservation.id,
              })),
            ]
          : [{ type: 'Reservations', id: 'LIST' }],
    }),
    reservation: builder.query<ReservationResponse, string>({
      query: (id) => `/reservations/${id}`,
      transformResponse: (response) =>
        parse(reservationResponseSchema, response),
      providesTags: (_result, _error, id) => [{ type: 'Reservation', id }],
    }),
    reservationSearch: builder.mutation<
      ReservationSearchResponse,
      ReservationSearch
    >({
      query: (body) => ({ url: '/reservations/search', method: 'POST', body }),
      transformResponse: (response) =>
        parse(reservationSearchResponseSchema, response),
    }),
    reservationQuoteCreate: builder.mutation<
      ReservationQuote,
      ReservationQuoteCreate
    >({
      query: (body) => ({ url: '/reservations/quote', method: 'POST', body }),
      transformResponse: (response) => parse(reservationQuoteSchema, response),
    }),
    reservationCreate: builder.mutation<ReservationResponse, ReservationCreate>(
      {
        query: (body) => ({ url: '/reservations', method: 'POST', body }),
        transformResponse: (response) =>
          parse(reservationResponseSchema, response),
        invalidatesTags: (result) =>
          result ? ['Reservations', 'Availability'] : [],
      },
    ),
    reservationCheckInQuote: builder.mutation<
      ReservationQuote,
      { id: string; version: number; arrivalDate: string }
    >({
      query: ({ id, version, arrivalDate }) => ({
        url: `/reservations/${id}/check-in/quote`,
        method: 'POST',
        body: { version, arrivalDate },
      }),
      transformResponse: (response) => parse(reservationQuoteSchema, response),
    }),
    reservationCheckIn: builder.mutation<
      ReservationResponse,
      {
        id: string
        version: number
        arrivalDate: string
        acceptedTotalMinor: number
        hasVehicle: boolean
        vehicleDescription: string
        licensePlate: string
        location: string
      }
    >({
      query: ({ id, ...body }) => ({
        url: `/reservations/${id}/check-in`,
        method: 'POST',
        body,
      }),
      transformResponse: (response) =>
        parse(reservationResponseSchema, response),
      invalidatesTags: (_result, _error, arg) => [
        'Camping',
        'Availability',
        'Reservations',
        { type: 'Reservation', id: arg.id },
        { type: 'Stays', id: 'LIST' },
      ],
    }),
    stays: builder.query<
      StayPage,
      { status: 'active' | 'closed'; page: number; pageSize: number }
    >({
      query: ({ status, page, pageSize }) =>
        `/stays?status=${status}&page=${page}&pageSize=${pageSize}`,
      transformResponse: (response) => parse(stayPageSchema, response),
      providesTags: (result) =>
        result
          ? [
              { type: 'Stays', id: 'LIST' },
              ...result.items.map((stay) => ({
                type: 'Stay' as const,
                id: stay.id,
              })),
            ]
          : [{ type: 'Stays', id: 'LIST' }],
    }),
    infiniteStays: builder.infiniteQuery<
      StayPage,
      {
        status: 'active' | 'closed'
        accommodation: 'total' | 'camping' | 'individual'
      },
      number
    >({
      infiniteQueryOptions: {
        initialPageParam: 1,
        getNextPageParam: (lastPage) =>
          lastPage.page * lastPage.pageSize < lastPage.total
            ? lastPage.page + 1
            : undefined,
      },
      query: ({ queryArg, pageParam }) =>
        `/stays?status=${queryArg.status}&accommodation=${queryArg.accommodation}&page=${pageParam}&pageSize=8`,
      transformResponse: (response) => parse(stayPageSchema, response),
      providesTags: [{ type: 'Stays', id: 'LIST' }],
    }),
    stay: builder.query<Stay, string>({
      query: (id) => `/stays/${id}`,
      transformResponse: (response) => parse(staySchema, response),
      providesTags: (_result, _error, id) => [{ type: 'Stay', id }],
    }),
    createStay: builder.mutation<{ id: string }, CheckInRequest>({
      query: (body) => ({ url: '/stays', method: 'POST', body }),
      transformResponse: (response) =>
        parse(createStayResponseSchema, response),
      invalidatesTags: [
        'Camping',
        'Availability',
        'Reservations',
        { type: 'Stays', id: 'LIST' },
      ],
    }),
    quote: builder.mutation<StayQuote, { id: string; departureDate: string }>({
      query: ({ id, departureDate }) => ({
        url: `/stays/${id}/quote`,
        method: 'POST',
        body: { departureDate },
      }),
      transformResponse: (response) => parse(stayQuoteSchema, response),
    }),
    closeStay: builder.mutation<
      Stay,
      {
        id: string
        departureDate: string
        version: number
        payment?: PaymentInput
      }
    >({
      query: ({ id, departureDate, version, payment }) => ({
        url: `/stays/${id}/close`,
        method: 'POST',
        body: { departureDate, version, ...(payment ? { payment } : {}) },
      }),
      transformResponse: (response) => parse(staySchema, response),
      invalidatesTags: (_result, _error, arg) => [
        'Camping',
        'Availability',
        'Reservations',
        { type: 'Stay', id: arg.id },
        { type: 'Stays', id: 'LIST' },
      ],
    }),
    addPayment: builder.mutation<Stay, { id: string; input: PaymentInput }>({
      query: ({ id, input }) => ({
        url: `/stays/${id}/payments`,
        method: 'POST',
        body: input,
      }),
      transformResponse: (response) => parse(staySchema, response),
      invalidatesTags: (_result, _error, arg) => [
        'Camping',
        'Availability',
        'Reservations',
        { type: 'Stay', id: arg.id },
        { type: 'Stays', id: 'LIST' },
      ],
    }),
    extraTemplates: builder.query<ExtraTemplate[], void>({
      query: () => '/extra-templates',
      transformResponse: (response) =>
        parse(extraTemplateSchema.array(), response),
      providesTags: ['Templates'],
    }),
    createExtraTemplate: builder.mutation<ExtraTemplate, ExtraTemplateInput>({
      query: (body) => ({ url: '/extra-templates', method: 'POST', body }),
      transformResponse: (response) => parse(extraTemplateSchema, response),
      invalidatesTags: ['Templates'],
    }),
    updateExtraTemplate: builder.mutation<
      ExtraTemplate,
      { id: string; patch: ExtraTemplatePatch }
    >({
      query: ({ id, patch }) => ({
        url: `/extra-templates/${id}`,
        method: 'PATCH',
        body: patch,
      }),
      transformResponse: (response) => parse(extraTemplateSchema, response),
      invalidatesTags: ['Templates'],
    }),
    addExtra: builder.mutation<Stay, { id: string; input: AddExtraInput }>({
      query: ({ id, input }) => ({
        url: `/stays/${id}/extras`,
        method: 'POST',
        body: input,
      }),
      transformResponse: (response) => parse(staySchema, response),
      invalidatesTags: (_result, _error, arg) => [
        'Camping',
        { type: 'Stay', id: arg.id },
        { type: 'Stays', id: 'LIST' },
      ],
    }),
    updateExtra: builder.mutation<
      Stay,
      {
        stayId: string
        extraId: string
        input: ExtraTemplateInput & { quantity: number }
      }
    >({
      query: ({ stayId, extraId, input }) => ({
        url: `/stays/${stayId}/extras/${extraId}`,
        method: 'PATCH',
        body: input,
      }),
      transformResponse: (response) => parse(staySchema, response),
      invalidatesTags: (_result, _error, arg) => [
        'Camping',
        { type: 'Stay', id: arg.stayId },
        { type: 'Stays', id: 'LIST' },
      ],
    }),
    deleteExtra: builder.mutation<Stay, { stayId: string; extraId: string }>({
      query: ({ stayId, extraId }) => ({
        url: `/stays/${stayId}/extras/${extraId}`,
        method: 'DELETE',
      }),
      transformResponse: (response) => parse(staySchema, response),
      invalidatesTags: (_result, _error, arg) => [
        'Camping',
        { type: 'Stay', id: arg.stayId },
        { type: 'Stays', id: 'LIST' },
      ],
    }),
    updateCampingProfile: builder.mutation<
      CampingProfile,
      CampingProfileUpdate
    >({
      query: (body) => ({ url: '/camping', method: 'PATCH', body }),
      transformResponse: (response) => parse(campingProfileSchema, response),
      invalidatesTags: (result, error) => {
        if (result)
          return [
            'Camping',
            'Availability',
            'Stays',
            'Stay',
            'Reservations',
            'Reservation',
          ]
        return error?.status === 409 ? ['Camping'] : []
      },
    }),
    updateMoneySettings: builder.mutation<
      CampingProfile,
      { moneyDecimals: 0 | null }
    >({
      query: (body) => ({
        url: '/camping/money-settings',
        method: 'PATCH',
        body,
      }),
      transformResponse: (response) => parse(campingProfileSchema, response),
      invalidatesTags: ['Camping'],
    }),
    createAccommodationType: builder.mutation<
      AccommodationType,
      AccommodationTypeCreate
    >({
      query: (body) => ({ url: '/accommodations/types', method: 'POST', body }),
      transformResponse: (response) => parse(accommodationTypeSchema, response),
      invalidatesTags: ['Accommodations', 'Availability'],
    }),
    updateAccommodationType: builder.mutation<
      AccommodationType,
      { id: string; body: AccommodationTypePatch }
    >({
      query: ({ id, body }) => ({
        url: `/accommodations/types/${id}`,
        method: 'PATCH',
        body,
      }),
      transformResponse: (response) => parse(accommodationTypeSchema, response),
      invalidatesTags: ['Accommodations', 'Availability'],
    }),
    updateAccommodationUnit: builder.mutation<
      AccommodationUnit,
      { id: string; body: AccommodationUnitPatch }
    >({
      query: ({ id, body }) => ({
        url: `/accommodations/units/${id}`,
        method: 'PATCH',
        body,
      }),
      transformResponse: (response) => parse(accommodationUnitSchema, response),
      invalidatesTags: ['Accommodations', 'Availability'],
    }),
    createAccommodationUnit: builder.mutation<
      AccommodationUnit,
      AccommodationUnitCreate
    >({
      query: (body) => ({ url: '/accommodations/units', method: 'POST', body }),
      transformResponse: (response) => parse(accommodationUnitSchema, response),
      invalidatesTags: ['Accommodations', 'Availability'],
    }),
    accommodationBeds: builder.query<
      z.infer<typeof accommodationBedSchema>[],
      string
    >({
      query: (id) => `/accommodations/units/${id}/beds`,
      transformResponse: (response) =>
        parse(accommodationBedSchema.array(), response),
      providesTags: ['Accommodations'],
    }),
    saveAccommodationBed: builder.mutation<
      z.infer<typeof accommodationBedSchema>,
      {
        unitId: string
        id?: string
        name: string
        position: number
        enabled: boolean
      }
    >({
      query: ({ unitId, id, ...body }) => ({
        url: `/accommodations/units/${unitId}/beds${id ? `/${id}` : ''}`,
        method: id ? 'PATCH' : 'POST',
        body,
      }),
      transformResponse: (response) => parse(accommodationBedSchema, response),
      invalidatesTags: ['Accommodations', 'Availability'],
    }),
    updateOccupancySettings: builder.mutation<
      CampingProfile,
      OccupancySettings
    >({
      query: (body) => ({
        url: '/camping/occupancy-settings',
        method: 'PATCH',
        body,
      }),
      transformResponse: (response) => parse(campingProfileSchema, response),
      invalidatesTags: ['Camping', 'Availability'],
    }),
    updateRates: builder.mutation<CampingProfile, RateInput>({
      query: (body) => ({ url: '/camping/rates', method: 'PATCH', body }),
      transformResponse: (response) => parse(campingProfileSchema, response),
      invalidatesTags: ['Camping'],
    }),
  }),
})

export const api = apiSlice
export const {
  useSessionQuery,
  useLoginMutation,
  useLogoutMutation,
  useCampingQuery,
  useAccommodationTypesQuery,
  useAccommodationUnitsQuery,
  useAvailabilityQuery,
  useLazyAvailabilityQuery,
  useLazyReservationsQuery,
  useReservationsQuery,
  useReservationQuery,
  useLazyReservationQuery,
  useReservationSearchMutation,
  useReservationQuoteCreateMutation,
  useReservationCreateMutation,
  useReservationCheckInQuoteMutation,
  useReservationCheckInMutation,
  useStaysQuery,
  useInfiniteStaysInfiniteQuery,
  useLazyStaysQuery,
  useStayQuery,
  useCreateStayMutation,
  useQuoteMutation,
  useCloseStayMutation,
  useAddPaymentMutation,
  useExtraTemplatesQuery,
  useCreateExtraTemplateMutation,
  useUpdateExtraTemplateMutation,
  useAddExtraMutation,
  useUpdateExtraMutation,
  useDeleteExtraMutation,
  useCreateAccommodationTypeMutation,
  useUpdateAccommodationTypeMutation,
  useCreateAccommodationUnitMutation,
  useUpdateAccommodationUnitMutation,
  useAccommodationBedsQuery,
  useSaveAccommodationBedMutation,
  useUpdateOccupancySettingsMutation,
  useUpdateRatesMutation,
  useUpdateCampingProfileMutation,
  useUpdateMoneySettingsMutation,
} = apiSlice
