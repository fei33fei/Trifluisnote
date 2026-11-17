; ---------------------------------------------------------------------------
; 安装器补充脚本（electron-builder nsis.include）
;
; 背景：electron-builder 自带的 APP_ASSOCIATE 宏只写三样东西 ——
;   扩展名 → ProgID、ProgID → 打开命令、ProgID 的图标。
; 它**不写** `Software\Classes\Applications\<exe>`。少了这一项，
; 应用就不会出现在 Windows 的「打开方式」列表里：
; 右键 md 文件 → 打开方式，列表里没有 Trifluisnote，只能去「选择其他应用」
; 里翻文件夹找 exe。默认关联虽然能用，但用户等于「没装上」。
;
; 这里把缺的键补上，并在卸载时清掉。
;
; 另外：安装时删掉「首次启动标记」，让每次安装之后的第一次启动
; 都能看到一次启动内容（示例文档）；之后启动一律空白页。
;
; 注意：portable 目标用的是另一份 NSIS 脚本（portable.nsi），
; 不会调用 customInstall，所以便携版不会往注册表里写临时路径 ——
; 这点必须保持，否则便携版会把「打开方式」指到一个随时会被清掉的临时目录。
; ---------------------------------------------------------------------------

!macro customInstall
  WriteRegStr SHELL_CONTEXT "Software\Classes\Applications\${APP_EXECUTABLE_FILENAME}" "" "${PRODUCT_NAME}"
  WriteRegStr SHELL_CONTEXT "Software\Classes\Applications\${APP_EXECUTABLE_FILENAME}\SupportedTypes" "md" "Markdown 文档"

  WriteRegStr SHELL_CONTEXT "Software\Classes\Applications\${APP_EXECUTABLE_FILENAME}\shell" "" "open"
  WriteRegStr SHELL_CONTEXT "Software\Classes\Applications\${APP_EXECUTABLE_FILENAME}\shell\open" "" "Open with ${PRODUCT_NAME}"
  WriteRegStr SHELL_CONTEXT "Software\Classes\Applications\${APP_EXECUTABLE_FILENAME}\shell\open\command" "" '"$INSTDIR\${APP_EXECUTABLE_FILENAME}" "%1"'

  ; 删掉首次启动标记 = 这次安装算「刚装好」，启动内容会再出现一次。
  ; （Windows 路径不区分大小写，Trifluisnote / trifluisnote 是同一个目录。）
  Delete "$APPDATA\Trifluisnote\first-run.done"

  !insertmacro UPDATEFILEASSOC
!macroend

!macro customUnInstall
  DeleteRegKey SHELL_CONTEXT "Software\Classes\Applications\${APP_EXECUTABLE_FILENAME}"
!macroend
