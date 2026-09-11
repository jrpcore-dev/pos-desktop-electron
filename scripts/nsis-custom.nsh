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
!macroend