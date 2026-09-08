# Vendia — Sistema de Ventas (POS)

![Electron](https://img.shields.io/badge/Electron-47848F?style=for-the-badge&logo=electron&logoColor=white)
![React](https://img.shields.io/badge/React-61DAFB?style=for-the-badge&logo=react&logoColor=black)
![Tailwind CSS](https://img.shields.io/badge/Tailwind_CSS-06B6D4?style=for-the-badge&logo=tailwindcss&logoColor=white)
![shadcn-ui](https://img.shields.io/badge/shadcn_ui-000000?style=for-the-badge&logo=shadcnui&logoColor=white)
![SQLite](https://img.shields.io/badge/SQLite-003B57?style=for-the-badge&logo=sqlite&logoColor=white)
![Expo](https://img.shields.io/badge/Expo-000020?style=for-the-badge&logo=expo&logoColor=white)

Sistema POS de escritorio con aplicación móvil complementaria para escaneo de códigos de barras.

## Arquitectura

- **Escritorio**: Electron + React + Tailwind CSS + shadcn/ui + SQLite (better-sqlite3)
- **Móvil**: Expo (React Native) con escáner de código de barras
- **Comunicación**: API REST local + descubrimiento UDP (subred LAN)

## Requisitos

- Node.js ≥ 18
- npm ≥ 10
- Windows (para build con Squirrel), Linux o macOS

## Instalación — Escritorio

```bash
# Clonar
git clone https://github.com/jrpcore-dev/pos-desktop-electron.git
cd my-pos-system

# Instalar dependencias
npm install

# Iniciar en modo desarrollo
npm start
```

### Build para distribución

```bash
# Crear instalador (.exe en Windows)
npm run make
```

El ejecutable se genera en `out/make/`.

## Instalación — App Móvil

```bash
cd mobile

# Instalar dependencias
npm install

# Iniciar servidor Expo
npx expo start
```

Escanea el código QR con Expo Go (SDK 57 beta) para abrir la app.

## Configuración

### Primera ejecución (escritorio)

1. Al abrir la app por primera vez, aparece el asistente de configuración
2. Ingresa el nombre del negocio
3. Crea el primer cajero (admin)
4. La app crea automáticamente la base de datos SQLite

### Conexión móvil ↔ escritorio

1. La app de escritorio inicia automáticamente un servidor API en el puerto **3456** y un discoverer UDP en el puerto **3457**
2. La app móvil descubre el servidor escaneando la subred local
3. Una vez conectada, muestra un indicador verde en el navbar del escritorio

## Uso

### Escritorio

- **Terminal de Venta**: Registrar ventas con búsqueda de productos
- **Caja**: Abrir/cerrar caja, retirar dinero, ver resumen y movimientos del día
- **Productos**: CRUD de productos con soporte para venta por pieza, kilo y caja
- **Categorías / Proveedores**: Gestión de catálogo
- **Movimientos**: Historial de entradas/salidas de stock (solo admin)
- **Reportes**: Ventas y gastos por período (solo admin)
- **Cajeros**: Gestión de perfiles con PIN (solo admin)
- **Respaldo**: Crear y restaurar backups de la base de datos (solo admin)
- **Interfaz moderna**: Tema claro/oscuro, tarjetas con hover interactivo, tablas resaltadas, skeletons de carga y spinners (Tailwind CSS + shadcn/ui)

### Móvil

- **Escáner**: Apunta al código de barras → muestra información del producto → permite aumentar stock o registrar producto nuevo
- **Búsqueda manual**: Busca productos por nombre, ve detalle, aumenta stock
- Autenticación por perfil (seleccionar cajero + ingresar PIN)

## Comandos útiles

```bash
# Escritorio
npm start              # Iniciar en desarrollo
npm run make           # Build para distribución

# Móvil
npx expo start         # Iniciar servidor Expo
npx expo start --android  # Iniciar en dispositivo Android
```
