Set WshShell = CreateObject("WScript.Shell")
WshShell.Run chr(34) & "D:\MyWebsite\run_server.bat" & Chr(34), 0
Set WshShell = Nothing