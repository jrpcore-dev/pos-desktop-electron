; Instalador de Vendia: sin asistente, solo una ventana de marca con la barra
; de progreso. Se mantiene oneClick: false porque el modo oneClick impone su
; propio banner (SpiderBanner) y cambia la carpeta de instalación por defecto, lo
; que dejaría duplicados en los equipos que ya tienen Vendia.

!include "LogicLib.nsh"

; Sin esto Windows escala la ventana y GetDeviceCaps siempre devuelve 96.
ManifestDPIAware true

; Tamaños base a 100 % de escala. Deben coincidir con scripts/generate-brand-assets.mjs.
!define VENDIA_SPLASH_W 460
!define VENDIA_SPLASH_H 280
!define VENDIA_BAR_X 70
!define VENDIA_BAR_Y 232
!define VENDIA_BAR_W 320
!define VENDIA_BAR_H 5
; COLORREF (0x00BBGGRR): azules del icono.
!define VENDIA_BAR_COLOR 0x00F78B5E
!define VENDIA_BAR_TRACK 0x005E3A2A

!macro vendiaHideItem PARENT ITEM
  GetDlgItem $0 ${PARENT} ${ITEM}
  ShowWindow $0 ${SW_HIDE}
!macroend

; Sin página "para quién instalar": se respeta la instalación existente (una
; instalación para todos los usuarios sigue actualizándose ahí, con elevación) y
; las nuevas van al usuario actual. El desinstalador conserva su comportamiento.
!macro customInstallMode
  !ifndef BUILD_UNINSTALLER
    ${If} $hasPerMachineInstallation == "1"
    ${AndIf} $hasPerUserInstallation != "1"
      StrCpy $isForceMachineInstall "1"
    ${Else}
      StrCpy $isForceCurrentInstall "1"
    ${EndIf}
  !endif
!macroend

; Sin página final: customInstall abre la app y cierra el instalador.
!macro customFinishPage
!macroend

; Se inserta justo antes de MUI_PAGE_INSTFILES, único gancho para añadirle SHOW.
!macro customPageAfterChangeDir
  !define MUI_PAGE_CUSTOMFUNCTION_SHOW vendiaSplashShow

  Function vendiaSplashShow
    ; Escala de pantalla: el bitmap no se estira, se elige el del tamaño exacto.
    System::Call "user32::GetDC(p 0)p.R0"
    System::Call "gdi32::GetDeviceCaps(p R0, i 88)i.R1"
    System::Call "user32::ReleaseDC(p 0, p R0)"

    InitPluginsDir
    ${If} $R1 >= 192
      StrCpy $R2 200
      File "/oname=$PLUGINSDIR\vendia-splash.bmp" "${BUILD_RESOURCES_DIR}\installerSplash-200.bmp"
    ${ElseIf} $R1 >= 168
      StrCpy $R2 175
      File "/oname=$PLUGINSDIR\vendia-splash.bmp" "${BUILD_RESOURCES_DIR}\installerSplash-175.bmp"
    ${ElseIf} $R1 >= 144
      StrCpy $R2 150
      File "/oname=$PLUGINSDIR\vendia-splash.bmp" "${BUILD_RESOURCES_DIR}\installerSplash-150.bmp"
    ${ElseIf} $R1 >= 120
      StrCpy $R2 125
      File "/oname=$PLUGINSDIR\vendia-splash.bmp" "${BUILD_RESOURCES_DIR}\installerSplash-125.bmp"
    ${Else}
      StrCpy $R2 100
      File "/oname=$PLUGINSDIR\vendia-splash.bmp" "${BUILD_RESOURCES_DIR}\installerSplash-100.bmp"
    ${EndIf}

    IntOp $R3 ${VENDIA_SPLASH_W} * $R2
    IntOp $R3 $R3 / 100
    IntOp $R4 ${VENDIA_SPLASH_H} * $R2
    IntOp $R4 $R4 / 100

    ; Oculta los controles del asistente (botones, encabezado, líneas).
    !insertmacro vendiaHideItem $HWNDPARENT 1
    !insertmacro vendiaHideItem $HWNDPARENT 2
    !insertmacro vendiaHideItem $HWNDPARENT 3
    !insertmacro vendiaHideItem $HWNDPARENT 1028
    !insertmacro vendiaHideItem $HWNDPARENT 1034
    !insertmacro vendiaHideItem $HWNDPARENT 1035
    !insertmacro vendiaHideItem $HWNDPARENT 1036
    !insertmacro vendiaHideItem $HWNDPARENT 1037
    !insertmacro vendiaHideItem $HWNDPARENT 1038
    !insertmacro vendiaHideItem $HWNDPARENT 1039
    !insertmacro vendiaHideItem $HWNDPARENT 1045
    !insertmacro vendiaHideItem $HWNDPARENT 1256

    ; Ventana sin marco y centrada: quita WS_CAPTION..WS_MAXIMIZEBOX, pone WS_POPUP.
    System::Call "user32::GetWindowLong(p $HWNDPARENT, i -16)i.R5"
    IntOp $R5 $R5 & 0xFF30FFFF
    IntOp $R5 $R5 | 0x80000000
    System::Call "user32::SetWindowLong(p $HWNDPARENT, i -16, i R5)i"
    System::Call "user32::GetSystemMetrics(i 0)i.R5"
    System::Call "user32::GetSystemMetrics(i 1)i.R6"
    IntOp $R5 $R5 - $R3
    IntOp $R5 $R5 / 2
    IntOp $R6 $R6 - $R4
    IntOp $R6 $R6 / 2
    ; SWP_NOZORDER | SWP_FRAMECHANGED
    System::Call "user32::SetWindowPos(p $HWNDPARENT, p 0, i R5, i R6, i R3, i R4, i 0x24)i"
    ; Esquinas redondeadas en Windows 11; en Windows 10 la llamada no tiene efecto.
    System::Call "dwmapi::DwmSetWindowAttribute(p $HWNDPARENT, i 33, *i 2, i 4)i"

    ; Página interna a tamaño completo, solo con la barra.
    FindWindow $R0 "#32770" "" $HWNDPARENT
    System::Call "user32::SetWindowPos(p R0, p 0, i 0, i 0, i R3, i R4, i 0x24)i"
    !insertmacro vendiaHideItem $R0 1006
    !insertmacro vendiaHideItem $R0 1016
    !insertmacro vendiaHideItem $R0 1027

    ; Imagen de fondo (WS_CHILD | WS_VISIBLE | SS_BITMAP), debajo de la barra.
    System::Call 'user32::CreateWindowEx(i 0, t "STATIC", t "", i 0x5000000E, i 0, i 0, i R3, i R4, p R0, p 0, p 0, p 0)p.R5'
    System::Call 'user32::LoadImage(p 0, t "$PLUGINSDIR\vendia-splash.bmp", i 0, i 0, i 0, i 0x10)p.R6'
    SendMessage $R5 0x172 0 $R6
    ; HWND_BOTTOM, SWP_NOSIZE | SWP_NOMOVE | SWP_NOACTIVATE
    System::Call "user32::SetWindowPos(p R5, p 1, i 0, i 0, i 0, i 0, i 0x13)i"

    ; Barra plana con los colores de la marca: requiere quitarle el tema visual.
    GetDlgItem $R5 $R0 1004
    System::Call 'uxtheme::SetWindowTheme(p R5, w " ", w " ")i'
    ; Sin WS_EX_CLIENTEDGE ni WS_EX_STATICEDGE
    System::Call "user32::GetWindowLong(p R5, i -20)i.R6"
    IntOp $R6 $R6 & 0xFFFDFDFF
    System::Call "user32::SetWindowLong(p R5, i -20, i R6)i"
    ; Sin WS_BORDER, con PBS_SMOOTH | PBS_MARQUEE. Es indeterminada a propósito: el
    ; extractor 7z y NSIS mueven la barra normal cada uno a su escala y retrocede.
    ; En marquee ignoran PBM_SETPOS y la animación no depende del hilo de instalación.
    System::Call "user32::GetWindowLong(p R5, i -16)i.R6"
    IntOp $R6 $R6 & 0xFF7FFFFF
    IntOp $R6 $R6 | 9
    System::Call "user32::SetWindowLong(p R5, i -16, i R6)i"
    SendMessage $R5 0x409 0 ${VENDIA_BAR_COLOR}
    SendMessage $R5 0x2001 0 ${VENDIA_BAR_TRACK}
    IntOp $R6 ${VENDIA_BAR_X} * $R2
    IntOp $R6 $R6 / 100
    IntOp $R7 ${VENDIA_BAR_Y} * $R2
    IntOp $R7 $R7 / 100
    IntOp $R8 ${VENDIA_BAR_W} * $R2
    IntOp $R8 $R8 / 100
    IntOp $R9 ${VENDIA_BAR_H} * $R2
    IntOp $R9 $R9 / 100
    ; HWND_TOP, SWP_NOACTIVATE | SWP_FRAMECHANGED
    System::Call "user32::SetWindowPos(p R5, p 0, i R6, i R7, i R8, i R9, i 0x30)i"
    ; PBM_SETMARQUEE
    SendMessage $R5 0x40A 1 30
  FunctionEnd
!macroend

!macro customInstall
  ; 1) Cierra la versión anterior si está corriendo
  ClearErrors
  nsExec::ExecToLog 'taskkill /F /IM "JRP POS.exe" /T >NUL 2>&1'
  ClearErrors
  nsExec::ExecToLog 'taskkill /F /IM "JRP_POS.exe" /T >NUL 2>&1'

  ; 2) Borra la instalación Squirrel anterior (solo binarios en %LocalAppData%)
  ClearErrors
  RMDir /r "$LOCALAPPDATA\JRP_POS"

  ; 3) Elimina accesos directos anteriores. Nota: NO usar "$COMMONDESKTOP\" — esa
  ;    constante no está definida en el instalador de electron-builder y NSIS la
  ;    expande como variable desconocida ("warning 6000") que se trata como error.
  ;    $DESKTOP y $SMPROGRAMS sí son válidas.
  IfFileExists "$DESKTOP\JRP POS.lnk" 0 +2
    Delete "$DESKTOP\JRP POS.lnk"
  IfFileExists "$DESKTOP\JRP_POS.lnk" 0 +2
    Delete "$DESKTOP\JRP_POS.lnk"
  IfFileExists "$SMPROGRAMS\JRP POS.lnk" 0 +2
    Delete "$SMPROGRAMS\JRP POS.lnk"
  IfFileExists "$SMPROGRAMS\JRP_POS.lnk" 0 +2
    Delete "$SMPROGRAMS\JRP_POS.lnk"
  IfFileExists "$SMPROGRAMS\Jacob Puc\JRP POS.lnk" 0 +2
    Delete "$SMPROGRAMS\Jacob Puc\JRP POS.lnk"
  RMDir "$SMPROGRAMS\Jacob Puc"

  ; 4) Sin página final: abre Vendia y cierra el instalador. En modo silencioso lo
  ;    decide la plantilla de electron-builder (--force-run).
  ${IfNot} ${Silent}
    StrCpy $1 ""
    ${If} ${isUpdated}
      StrCpy $1 "--updated"
    ${EndIf}
    HideWindow
    ${StdUtils.ExecShellAsUser} $0 "$launchLink" "open" "$1"
    !insertmacro quitSuccess
  ${EndIf}
!macroend
