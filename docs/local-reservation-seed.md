# Semillas locales de reservas

`pnpm db:seed:reservations` agrega datos ficticios al camping indicado por
`CAMPING_KEY` (por defecto `la-izuelina`). Requiere una base PostgreSQL de
bucle local, rechaza `NODE_ENV=production` y rechaza `DATABASE_ADMIN_URL`.
Usa la primera reserva estable para conservar el ancla de fechas entre
ejecuciones; nunca mueve ni reemplaza filas existentes.

En la base local actual, `la-izuelina` se muestra como **Ekko Hostel** y la
semilla usa el usuario habilitado existente del camping; no crea credenciales.

La semilla crea, si faltan, el tipo individual `Habitación privada` con tres
unidades (`Habitación 1`, `Habitación 2`, `Habitación 3`) y precio de 45.000
CLP por noche, además del tipo ilimitado `Camping`, que usa las tarifas
por persona actuales del camping. Luego crea doce reservas ficticias, con
reservas confirmadas e ingresadas, pagos parciales en efectivo,
transferencia y tarjeta, y nombres y notas ficticios naturales. La matriz incluye un
ingreso para hoy, una salida para hoy, una estadía vencida y reservas futuras en
días con inventario parcial, lleno y vacío para probar el calendario compacto.

Los tipos, unidades, reservas y pagos usan claves estables. Los reintentos
reanundan pasos incompletos mediante las operaciones normales de la API,
incluidas cotización, confirmación, ingreso y pagos, y dejan los cambios del
operador intactos. Un conflicto de disponibilidad se informa y no modifica la
reserva que lo causó; se puede volver a ejecutar cuando el conflicto se
resuelva.

```sh
pnpm db:seed:reservations
pnpm db:seed:reservations -- --camping-key=la-izuelina
```

La orden imprime un resumen de reservas, pagos, estadías activas y lecturas de
disponibilidad para la misma sesión del camping.
