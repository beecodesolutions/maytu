# Contrato del piloto

Base `/api`. JSON; cookie de sesión `camping_session`. Todos los endpoints de negocio requieren sesión. Mutaciones verifican `Origin`; producción exige origen HTTPS configurado. No se acepta `camping_id` ni `campingId` en cuerpos: ámbito viene del usuario autenticado.

| Método | Ruta                                         | Resultado                                                                |
| ------ | -------------------------------------------- | ------------------------------------------------------------------------ |
| POST   | `/auth/login`                                | Usuario y cookie de 12 horas                                             |
| GET    | `/auth/session`                              | Usuario autenticado                                                      |
| POST   | `/auth/logout`                               | Revoca sesión y elimina cookie                                           |
| GET    | `/camping`                                   | Configuración persistida y ocupación activa                              |
| PATCH  | `/camping/rates`                             | Tarifas para futuros ingresos                                            |
| POST   | `/stays`                                     | Registra ingreso; devuelve `{ id }`                                      |
| GET    | `/stays?status=active&page=1&pageSize=25`    | Página de estadías; `status=closed` para cerradas, máximo 100 por página |
| GET    | `/stays/:id`                                 | Detalle, extras aplicados y cierre si existe                             |
| POST   | `/stays/:id/quote`                           | Presupuesto con `{ departureDate }`; devuelve versión                    |
| POST   | `/stays/:id/payments`                        | Registra pago parcial o anticipo idempotente                             |
| POST   | `/stays/:id/close`                           | Cierra con `{ departureDate, version, payment? }`; saldo final cero      |
| POST   | `/reservations/quote`                        | Cotiza una reserva sin crearla ni consumir inventario                    |
| POST   | `/reservations`                              | Crea una reserva confirmada con total aceptado                           |
| GET    | `/reservations`                              | Lista reservas por estado, tipo y rango, con paginación                  |
| GET    | `/reservations/:id`                          | Consulta una reserva, sus pagos y cuenta                                 |
| POST   | `/reservations/:id/quote`                    | Cotiza una edición con la versión actual                                 |
| PATCH  | `/reservations/:id`                          | Edita una reserva confirmada                                             |
| POST   | `/reservations/:id/cancel`                   | Cancela una reserva confirmada                                           |
| POST   | `/reservations/:id/no-show`                  | Marca no presentado desde la fecha de entrada                            |
| POST   | `/reservations/:id/check-in/quote`           | Cotiza el ingreso con fecha real y versión actual                        |
| POST   | `/reservations/:id/check-in`                 | Ingresa la reserva y crea su estadía vinculada                           |
| POST   | `/reservations/:id/payments`                 | Registra un pago manual idempotente                                      |
| POST   | `/reservations/:id/payments/:paymentId/void` | Anula un pago con motivo, sin devolución bancaria                        |
| GET    | `/extra-templates`                           | Plantillas del camping, incluidas desactivadas                           |
| POST   | `/extra-templates`                           | Crea plantilla                                                           |
| PATCH  | `/extra-templates/:id`                       | Edita o desactiva plantilla                                              |
| POST   | `/stays/:id/extras`                          | Aplica plantilla o extra libre                                           |
| PATCH  | `/stays/:id/extras/:extraId`                 | Edita copia aplicada                                                     |
| DELETE | `/stays/:id/extras/:extraId`                 | Elimina copia aplicada de estadía abierta                                |
| GET    | `/accommodations/types`                      | Lista tipos habilitados y deshabilitados                                 |
| POST   | `/accommodations/types`                      | Crea un tipo de alojamiento                                              |
| GET    | `/accommodations/types/:id`                  | Consulta un tipo de alojamiento                                          |
| PATCH  | `/accommodations/types/:id`                  | Edita un tipo de alojamiento                                             |
| GET    | `/accommodations/units`                      | Lista unidades, opcionalmente filtradas por tipo                         |
| POST   | `/accommodations/units`                      | Crea una unidad identificada                                             |
| GET    | `/accommodations/units/:id`                  | Consulta una unidad                                                      |
| PATCH  | `/accommodations/units/:id`                  | Edita una unidad                                                         |
| GET    | `/accommodations/blocks`                     | Lista bloqueos por tipo, unidad o rango                                  |
| POST   | `/accommodations/blocks`                     | Crea un bloqueo                                                          |
| GET    | `/accommodations/blocks/:id`                 | Consulta un bloqueo                                                      |
| PATCH  | `/accommodations/blocks/:id`                 | Edita un bloqueo                                                         |
| DELETE | `/accommodations/blocks/:id`                 | Libera un bloqueo                                                        |
| GET    | `/availability`                              | Disponibilidad nocturna por tipo y unidades                              |

Disponibilidad recibe `checkInDate` y `checkOutDate` como fechas ISO de
calendario, con intervalo `[checkInDate, checkOutDate)` y máximo de 366
noches. El cálculo es de calendario puro y no cambia por horario de verano.
`typeId` es opcional. Devuelve tipos habilitados y deshabilitados. Para
`individual`, las noches incluyen totales, reservas, bloqueos y disponibilidad,
y `availableUnitIds` contiene las unidades libres durante todo el intervalo.
Para `unlimited`, las noches incluyen reservas y personas por rango etario, sin
conteos de capacidad. Reservas `pending`, `confirmed` y `checked_in` consumen
inventario; estados terminales no lo hacen. Reservas y bloqueos se combinan por
unión de unidades para evitar doble conteo de conflictos históricos.

Las listas de tipos no aceptan filtros y siempre devuelven ambos estados. La
lista de unidades acepta `typeId`. La lista de bloqueos acepta `typeId`,
`unitId` y un par completo `checkInDate`/`checkOutDate`; si se envía una fecha
debe enviarse la otra, y la salida debe ser posterior.

Pagos: `POST /stays/:id/payments` registra un pago parcial o anticipo y devuelve estadía actualizada. Cuerpo: `{ amountMinor, method, paidOn, note?, idempotencyKey }`. Importe entero positivo en moneda de la estadía; medios `cash`, `transfer`, `card`; fecha calendario no futura según zona horaria del camping. `idempotencyKey` UUID identifica el intento lógico: reenviar mismos datos conserva un único pago; reutilizar clave para otros datos o estadía responde 409.

`GET /stays/:id` incluye `payments` (importe, medio, fecha, nota y auditoría) y `account`: `totalMinor`, `paidMinor`, `balanceMinor`, `asOfDate`. Para estadías abiertas se calcula alojamiento acumulado hasta hoy más extras; para cerradas se usa costo final congelado. Saldo negativo representa anticipo a favor. `GET /camping` incluye `pendingAmountMinor`: suma de saldos positivos por estadía, sin compensar créditos de otros huéspedes.

El presupuesto de cierre incluye `account` calculado con fecha de salida elegida. Cierre exige saldo exactamente cero; `payment` opcional registra el pago final y cierra en una sola transacción. Si falla versión, validación o saldo, no guarda ese pago. Anticipos mayores al costo acumulado se admiten en estadías abiertas; si sobra crédito al cierre, no se puede cerrar hasta resolverlo. Este MVP no incluye devoluciones ni edición/anulación de pagos. Registrar pago es anotar cobro recibido, no ejecutar cargo bancario.

Estadías cerradas antes de habilitar pagos conservan su cierre y pueden registrar cobros pendientes hasta completar costo final. No se inventan pagos históricos al migrar. Sus saldos reflejan exclusivamente pagos registrados.

Ingreso conserva responsable, documento, nacionalidad ISO, teléfono E.164, fechas, cantidades por rango, vehículo y ubicación. Strings opcionales se envían vacíos; no se persisten edades individuales. Esquemas exactos y validaciones compartidas: [contracts/src/index.ts](../contracts/src/index.ts).

Plantilla: `{ description, category?, unitPriceMinor }`. `category` es texto libre de hasta 100 caracteres; omitir al crear equivale a vacío. PATCH de plantilla preserva campos omitidos. No hay entidad ni identificador de categoría.

Aplicación desde plantilla: `{ templateId, quantity }`. Extra libre: `{ description, category?, unitPriceMinor, quantity }`. Precio CLP en pesos enteros, cantidad entera positiva. Se copia categoría/descripción/precio; cambios posteriores de plantilla no alteran estadías. Editar extra aplicado requiere descripción, precio y cantidad; categoría omitida se conserva.

Presupuesto devuelve `nights`, `accommodationMinor`, `extrasMinor`, `totalMinor` y `version`. Cierre requiere esa versión: si cambió un extra o se registró un pago, responde `409 STALE_STAY`; pedir nuevo presupuesto y confirmar de nuevo. Repetir cierre con igual fecha devuelve cierre original; distinta fecha responde 409. Cierre, pagos y modificaciones de extras bloquean la misma fila para evitar costos inconsistentes.

Validación devuelve 400; falta de sesión 401; origen rechazado 403; recurso inexistente o de otro camping 404; conflicto 409. Respuestas no se cachean. No reintentar automáticamente ingresos/extras tras error de red ambiguo: consultar antes para evitar duplicados. Cierre y registro de pagos soportan repetición idempotente. Si el cierre incluye pago, conservar también su clave y datos al reintentar.

Las reservas se cotizan antes de crear o editar. La cotización valida que el
tipo y, cuando corresponde, la unidad existan y estén disponibles, pero no
crea una retención. La creación recibe los mismos datos de alojamiento y
ocupación junto con contacto, `idempotencyKey` y `acceptedTotalMinor`; el
servicio vuelve a calcular el precio y responde `409 PRICE_CHANGED` si el
total aceptado ya no coincide. El campo `source` es el canal de reserva y se
normaliza a `manual` si se omite; en eventos de outbox aparece como
`bookingSource`. El origen técnico de las mutaciones locales es siempre
`origin: manual`. La respuesta incluye el snapshot completo, todos los pagos
(también los anulados) y `account` con `totalMinor`, `paidMinor` y
`balanceMinor`.

El precio se calcula por unidad y noche para alojamientos individuales. Para
camping se calcula por persona y noche con los rangos de edad y tarifas
congelados en el snapshot. Un total manual (`agreedTotalMinor`) exige
`priceAdjustmentReason`; ambos campos deben aparecer juntos. No se aceptan
flotantes ni se recalculan importes de dinero silenciosamente. Cambiar fechas,
personas, tipo o unidad exige aceptar un nuevo total, incluso si el importe
resultara igual. El contacto y las notas pueden cambiar sin cambiar el
precio. Si una edición conserva el tipo, usa las tarifas, unidad base,
moneda y ajuste guardados; cambiar la configuración no recalcula la reserva.
Cambiar de tipo usa la configuración vigente del nuevo tipo. La auditoría y
el outbox se escriben junto con cada mutación exitosa y registran al usuario de
la sesión; los reintentos idempotentes no crean una segunda mutación.

Una reserva se crea confirmada y consume inventario desde su creación. Las
reservas confirmadas pueden cancelarse. El
no-show puede marcarse desde la fecha de entrada en la zona horaria del
camping. Las transiciones y ediciones llevan `version` positiva y aumentan la
versión en cada mutación. Repetir una transición que ya alcanzó su estado
objetivo devuelve la última representación sin crear otro evento; una versión
obsoleta responde 409. Repetir una creación con la misma clave y payload
normalizado devuelve la reserva existente; cambiar el payload responde 409.

Cada reserva admite pagos nuevos mientras está confirmada. Los
medios son `cash`, `transfer` y `card`; se permiten varios pagos y un excedente
se muestra como crédito. Cancelar conserva sus pagos y sus cargos. Un pago
puede anularse mientras la reserva esté confirmada, cancelada o
marcada no-show; la anulación conserva actor, fecha y motivo y no ejecuta una
devolución bancaria. Antes del ingreso, esta regla aplica a los pagos propios
de la reserva. Repetir la misma clave de idempotencia con el payload
inmutable devuelve la reserva con el pago existente, incluso después de
anularlo, ingresar la reserva o cerrar su estadía, sin incrementar versión ni
crear auditoría/outbox; cambiar el payload responde 409. Repetir una anulación
con el mismo motivo devuelve el estado actual sin nueva mutación y cambiarlo
responde 409.

El ingreso desde una reserva usa dos operaciones. `POST
/reservations/:id/check-in/quote` recibe `{ version, arrivalDate }` y devuelve
la cotización del ingreso. La fecha real debe ser igual o posterior a la
entrada reservada, no puede superar el día local actual y debe ser anterior a
la salida reservada. La cotización conserva la tarifa base, moneda, rangos y
ajustes absolutos de la reserva; una llegada anticipada requiere editar primero
la fecha de la reserva y aceptar su nuevo total. Una llegada posterior exige
una nueva cotización cuando cambia el precio.

`POST /reservations/:id/check-in` recibe esa versión, `arrivalDate`,
`acceptedTotalMinor` y los datos físicos de la llegada (`hasVehicle`,
`vehicleDescription`, `licensePlate` y `location`). El ingreso exige que el
total aceptado coincida con la cotización y crea como máximo una estadía para
la reserva. La respuesta de reserva incluye `stayId`; la estadía incluye
`reservationId` y `accommodationPriceSnapshot`. Los pagos existentes quedan
vinculados a la reserva y a la nueva estadía mediante sus dos identificadores;
no se duplican registros. Repetir el ingreso ya realizado devuelve la misma
representación si la fecha y los datos normalizados de llegada coinciden. Una
repetición cuando la reserva ya está en `checked_in` valida la fecha real y los
datos de vehículo y ubicación, ignora `version` y `acceptedTotalMinor`, y
devuelve la estadía existente sin recalcular precio ni crear un cobro nuevo.
Esto permite reintentar después de extender la salida y recalcular la estadía
actual. Intentar ingresar una reserva en `checked_out` responde conflicto.

Una estadía física abierta bloquea su unidad aunque su fecha de salida
planificada ya haya pasado. En una estadía vinculada, la cotización y el PATCH
solo permiten cambiar la salida. Mientras la reserva está en `checked_in`, su
cotización y PATCH solo aceptan ese cambio de salida y, cuando corresponde, el
par explícito de ajuste (`agreedTotalMinor` y `priceAdjustmentReason`); no se
editan contacto, ocupantes ni otros datos. Cualquier cambio que afecte el
alojamiento requiere una cotización de reserva y un total aceptado antes de
actualizar la estadía. La salida planificada, el snapshot de alojamiento y la
versión de la estadía se mantienen sincronizados con la reserva.

La cuenta de una estadía vinculada suma el alojamiento completo aceptado por la
reserva más los extras activos; no sustituye el total congelado por un cálculo
acumulado hasta hoy. Su cotización y cierre requieren que la salida de la
reserva ya tenga la cotización y el PATCH aceptados cuando haya cambiado. El
cierre requiere saldo cero y confirma la salida y el
estado de la reserva en una sola transacción. Repetir el mismo cierre devuelve
el resultado original. Los pagos nuevos registrados por la ruta de estadía
conservan ambos identificadores. Un pago vinculado puede anularse desde la
ruta de pagos de la reserva mientras la estadía vinculada esté abierta y la
reserva siga en `checked_in`; la anulación incrementa ambas versiones. Los
pagos de una estadía cerrada no se pueden anular. Las estadías creadas sin
reserva mantienen el flujo directo anterior.

## Precisión monetaria por camping

`GET /camping` incluye `moneyDecimals`: `0` (valor predeterminado, importes
enteros) o `null` (precisión nativa de la moneda, por ejemplo dos decimales
para MXN; CLP sigue sin centavos). `PATCH /camping/money-settings` recibe
exclusivamente `{ "moneyDecimals": 0 }` o `{ "moneyDecimals": null }`, exige
sesión y Origin y registra el cambio en auditoría dentro de la transacción.

Todos los contratos siguen usando **unidades menores enteras**. En MXN,
escribir `1200` en la UI produce `120000` en `amountMinor`; en CLP produce
`1200`. No se convierten monedas ni se cambia la escala de los datos.

Las nuevas reservas y estadías congelan la preferencia. Si no admiten centavos,
el total calculado se redondea una vez a la unidad monetaria más cercana
(mitad hacia arriba); `roundingMinor` expone la diferencia frente a alojamiento
más extras. Un total manual, precio nuevo o pago debe respetar la precisión
permitida. Las plantillas antiguas conservan su precio: aplicarlas copia el
importe exacto y el redondeo se realiza al calcular el total final.

Las estadías anteriores conservan `moneyDecimals: null`. Los snapshots de
reservas anteriores sin el campo mantienen la precisión original, incluido su
check-in y sus recotizaciones. Cambiar la configuración no cambia precios,
pagos, snapshots ni cierres existentes. La UI muestra los centavos históricos
cuando existen y permite saldarlos exactamente, aunque el camping hoy opere
sin centavos. Los importes enteros se muestran sin decimales artificiales.
