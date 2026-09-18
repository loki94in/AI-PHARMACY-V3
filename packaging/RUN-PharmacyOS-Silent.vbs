Set fso = CreateObject("Scripting.FileSystemObject")
appDir = fso.GetParentFolderName(WScript.ScriptFullName)
Set WshShell = CreateObject("WScript.Shell")
WshShell.CurrentDirectory = appDir
WshShell.Run chr(34) & appDir & "\PharmacyOS.exe" & chr(34), 0, False
Set WshShell = Nothing
