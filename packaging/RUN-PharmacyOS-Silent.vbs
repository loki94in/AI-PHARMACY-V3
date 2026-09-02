Set WshShell = CreateObject("WScript.Shell")
WshShell.Run chr(34) & WshShell.CurrentDirectory & "\PharmacyOS.exe" & chr(34), 0, False
Set WshShell = Nothing
