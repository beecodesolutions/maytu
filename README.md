# Maytu

<img src="ui/public/maytu-mark.svg" alt="Logo de Maytu" width="64">

Maytu es una aplicación de gestión de alojamientos para campings y hostels.
Permite cotizar reservas, consultar disponibilidad y ocupación, registrar
ingresos y salidas, y gestionar extras, pagos y cierres de estadías.

El frontend usa React, MUI y RTK Query. La API usa NestJS, TypeORM y PostgreSQL.
El frontend y la API comparten contratos Zod. El modo demo usa MSW.

## Arranque local

Requisitos: Node 24.14.1 (`.nvmrc`), pnpm 10.30.1 y Docker Compose. No requiere cuenta AWS ni Supabase.

```sh
nvm use
pnpm install
pnpm db:up
pnpm db:migrate
pnpm db:seed
# Aprovisionar un usuario manual: ver api/README.md antes de ingresar.
pnpm dev
```

PostgreSQL escucha solo en `127.0.0.1:5434`, base `camping`. API en puerto 3010; Vite anuncia URL del frontend y envía `/api` por proxy. Credenciales de PostgreSQL en Compose son únicamente locales. `CAMPING_DB_PORT` permite cambiar puerto; actualizar URL de API también.

`ui/.env.development` configura `DEV_HOST=0.0.0.0` para acceder desde la red local con `pnpm dev`. Para limitarlo a esta computadora, usar `DEV_HOST=localhost` en `ui/.env.development.local`. Para iniciar sesión desde otro dispositivo, agregar su URL de acceso al frontend (por ejemplo, `http://192.168.1.82:5173`) a `ALLOWED_ORIGIN` en `api/.env` y reiniciar API. Usar el servidor de desarrollo solo en redes de confianza.

`pnpm db:down` detiene base sin borrar volumen. No usar `docker compose down -v` si se quieren conservar datos.

### Usuarios

Usuarios se aprovisionan desde CLI; no hay registro público. Contraseñas nunca se guardan en texto plano. Consultar `pnpm user --help` para crear usuario, cambiar contraseña o deshabilitarlo. Credenciales de base administrativas se reservan para migraciones, seed y CLI. No colocar secretos en variables `VITE_*`.

### Modo mock

```sh
pnpm dev:mock
```

MSW conserva datos ficticios en memoria del navegador; recargar reinicia demo. Modo real es predeterminado. `VITE_ENABLE_MOCKS=true` habilita mocks explícitamente, también en builds demo existentes. No existe bypass equivalente en API real.

### Datos ficticios para probar UI real

Después de migrar, ejecutar seed y crear usuario local:

```sh
pnpm db:seed:demo
```

Agrega 12 estadías activas y 12 cerradas al alojamiento de demostración, con nombres ficticios: distintas fechas, grupos, vehículos, extras de plantilla y libres. Permite probar paginación, ocupación, detalle, presupuestos y cierres. Repetir no duplica ni sobrescribe registros, tampoco reabre estadías cerradas desde UI. Fechas se calculan al crear cada registro; siguientes ejecuciones las conservan. Usa tarifas/configuración actuales y calcula cierres con la misma lógica de la API.

Solo admite PostgreSQL local y rechaza `NODE_ENV=production`. No crea usuarios, modifica plantillas ni borra datos existentes. Recargar navegador tras ejecutar. Estos registros son ficticios, no historia real del camping.

Para probar el flujo de reservas con inventario individual y camping, usar [`docs/local-reservation-seed.md`](docs/local-reservation-seed.md):

```sh
pnpm db:seed:reservations
```

## Reglas de operación

- Tarifas, moneda y rangos se copian al ingreso. Cambios de tarifas afectan nuevos ingresos solamente.
- Noches = diferencia de fechas calendario, mínimo una. Cierre registra salida real; fecha estimada no libera ocupación.
- `hasVehicle` permite vehículo sin patente/descripción; no cobra automáticamente.
- Extras son plantillas, con categoría como texto libre (sin tabla aparte). Al aplicarlas se copian descripción, categoría y precio; editar plantilla no modifica estadías existentes.
- Extras libres no crean plantillas. Cantidad × precio unitario, cargo único; presentación forma parte de descripción (dos paquetes de seis empanadas son doce empanadas).
- Cierre calcula alojamiento + extras y congela resultado; exige saldo exactamente cero. Puede registrar pago final de forma atómica. Repetir mismo cierre no duplica cargos ni pagos.
- Reservas futuras se cotizan antes de crear o editar; la creación exige `acceptedTotalMinor` y rechaza `PRICE_CHANGED` si el precio se modificó. El snapshot congela moneda, tarifa o rangos, unidad base y ajustes.
- Reservas pendientes consumen inventario; confirmar, cancelar y no-show requieren versión. No-show solo procede desde la fecha de entrada local. Los cambios que afectan el precio requieren aceptar un nuevo total.
- Reservas admiten pagos múltiples en efectivo, transferencia o tarjeta. Se muestran pagos anulados y crédito por sobrepago; las anulaciones conservan motivo y no hacen devoluciones bancarias.
- El ingreso desde una reserva usa cotización y confirmación separadas. La llegada real debe estar entre la entrada reservada y el día local actual, y antes de la salida reservada. Una llegada anticipada requiere editar primero la fecha de reserva; una llegada tardía que cambie el precio requiere una nueva cotización.
- Una reserva ingresada crea como máximo una estadía vinculada. `stayId` y `reservationId` relacionan ambas representaciones; los pagos existentes se conservan y reciben ambos vínculos, sin copias. La estadía guarda el snapshot de alojamiento aceptado.
- Una unidad con estadía física abierta permanece bloqueada aunque la salida planificada haya pasado. Las estadías vinculadas calculan la cuenta con el alojamiento completo aceptado más extras, sincronizan salida y versión con la reserva, y cierran con saldo cero en una transacción atómica. Los pagos vinculados solo se anulan mientras la estadía esté abierta y la reserva siga ingresada.
- `source` identifica el canal de reserva y por defecto es `manual`; los eventos locales mantienen `origin: manual` y exponen el canal como `bookingSource`. Repetir un payload idempotente no crea otra versión, auditoría ni evento.
- En estadías, los pagos parciales y anticipos son en efectivo, transferencia o tarjeta: importe, fecha y nota. Saldo = costo calculado menos pagos registrados. Anticipo excedente se muestra como saldo a favor; no compensa deuda de otros grupos. No hay procesador bancario, devoluciones, descuentos, impuestos adicionales ni reapertura.

No se exponen huéspedes públicamente. Cada operación resuelve camping desde usuario autenticado.

## Estructura y comandos

- `ui/`: frontend, formularios, RTK Query y MSW.
- `contracts/`: esquemas y tipos compartidos; datos confirmados de seed, sin fallback de configuración en UI real.
- `api/`: Nest, entidades, migraciones, CLI, pruebas y handler Lambda. [Contrato HTTP](docs/api.md) y [operación](api/README.md).
- OpenAPI: [documentación y exportación estática](docs/openapi.md). [Reservas, inventario y disponibilidad](docs/reservations.md) documentan las rutas publicadas por cada etapa; las etapas 3 y 4 publican cotización, reservas, ciclo de vida, ingreso vinculado, pagos y anulaciones. El cliente RTK Query se generará después.
- `infra/template.yaml`: plantilla AWS SAM de la API. [Despliegue y operación](docs/deployment.md).

```sh
pnpm typecheck
pnpm lint
pnpm test
pnpm format:check
pnpm package:lambda
```

Pruebas backend usan PostgreSQL real en base separada `camping_test`, nunca la base de desarrollo. Crear una vez con `docker compose exec database createdb -U camping camping_test`. Por defecto usan `camping_test` en el mismo servidor local; para otra conexión, pasar `DATABASE_URL` con esa base. Pruebas deben fallar si apuntan a base no identificada como test.

## Pruebas automáticas en GitHub

El workflow **Checks** corre únicamente en PRs hacia `main`. Usa Node y pnpm
según `package.json`, comprueba tipos y lint, y
ejecuta los tests de contratos, API, UI y los controles offline del despliegue.
Los tests de API usan PostgreSQL temporal con base `camping_test`; los archivos
se ejecutan en serie porque la prueba de migraciones reconstruye el esquema.
No necesita secretos ni acceso a AWS, Supabase o datos de producción. Su resultado
aparece como **Types, lint and tests** en los checks del PR. El despliegue sigue
siendo un workflow separado que se ejecuta al actualizar `main`.

## AWS + Supabase

Arquitectura: frontend → API Gateway HTTP API → Lambda Node 24 → PostgreSQL Supabase. No se usan Supabase Auth, Data API ni SDK desde frontend.

`pnpm package:lambda` empaqueta dentro de Linux, conserva metadata de Nest y comprueba carga del handler y Argon2 en imagen del runtime Lambda. Resultado en `.artifacts/lambda.zip`, con enlaces pnpm preservados y verificación del ZIP extraído. No ejecuta deploy.

Antes de desplegar:

1. Elegir regiones próximas entre Lambda y Supabase; revisar cuotas, presupuesto y elegibilidad Free Tier de cuenta real.
2. Crear esquema privado y rol runtime limitado con procedimiento de `api/`; usar credencial administrativa separada para migraciones/seed.
3. Runtime conecta a Supavisor **transaction mode** (puerto 6543), TLS verificado, pool pequeño. Migraciones usan conexión directa o pooler **session mode** (5432). No usar prepared statements con nombre ni estado de sesión dependiente del pooler.
4. Guardar URL runtime en secreto AWS con clave `DATABASE_URL`; plantilla recibe ARN, no valor. Rotar secreto requiere actualizar configuración de función para refrescar referencia resuelta.
5. Definir frontend y API bajo mismo sitio (dominios propios o proxy). Cookie `HttpOnly`, `Secure`, `SameSite=Lax`; origen exacto permitido. Endpoint execute-api y frontend externo no bastan para asumir cookies compatibles.
6. Ejecutar migraciones, seed y aprovisionamiento explícitamente desde entorno autorizado; nunca al arrancar Lambda.
7. Validar plantilla SAM y después autorizar despliegue por separado. Este trabajo no crea recursos remotos.

Plantilla: una Lambda, 512 MB, timeout 15s, pool 2, logs 7 días y throttling. Sin NAT, VPC, RDS, RDS Proxy ni provisioned concurrency. Concurrencia reservada opcional depende de cuota de cuenta. API no requiere acceso AWS a secretos durante cada request: referencia de CloudFormation se resuelve al desplegar; rol de despliegue necesita permiso correspondiente.

Evidencia y alcance de pruebas: [validación local](docs/verification.md).

## Limitaciones y operación

Sesiones de 12 horas y límites de login persistidos en PostgreSQL. Logout y cambio de contraseña revocan acceso. Datos de huéspedes, cookies y contraseñas no se registran en logs. No reintentar escrituras automáticamente ante resultados ambiguos de red; comprobar estadía antes de repetir ingreso o extra. Pagos usan claves de idempotencia para reintentar el mismo registro sin duplicarlo.

Supabase Free puede pausar proyectos de baja actividad y no incluye backups automáticos. Antes de usar datos reales, establecer backup cifrado externo y verificar restauración. Copias mediante `pg_dump` con URL administrativa; restaurar primero en base nueva y comprobar conteos, relaciones y acceso. No guardar dumps con huéspedes en repositorio.

AWS Free Tier y créditos no garantizan factura cero permanente. Revisar [AWS Free Tier](https://aws.amazon.com/free/free-tier-faqs/), [HTTP API](https://aws.amazon.com/api-gateway/pricing/) y [Supabase](https://supabase.com/pricing/) al abrir cuenta. Alertas de presupuesto avisan, no constituyen límite duro de gasto.

Maytu usa Vercel, Lambda y Supabase; consultar [despliegue y operación](docs/deployment.md) para recursos, verificaciones y rollback. Los costos y créditos requieren seguimiento; validación local no equivale a operación cloud verificada.

### Actualizar base local para pagos

Ejecutar `pnpm db:migrate` y reiniciar API tras actualizar código. Con rol runtime restringido, volver a ejecutar `pnpm runtime:provision` usando credencial administrativa para conceder acceso a tabla de pagos. La migración no infiere pagos para estadías existentes.
