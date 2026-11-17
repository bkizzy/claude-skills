-- Bonsai Chat launcher: starts the model server, the speech server and Open WebUI, opens Open WebUI, stops all three on Quit.
-- build_app.sh fills in the install folder on the next line.
property root : "__ROOT__"
property base : root & "/bonsai"
property webui : root & "/open-webui"
property tts : root & "/pocket-tts"
property modelURL : "http://127.0.0.1:8765"
property ttsURL : "http://127.0.0.1:8767"
property theURL : "http://127.0.0.1:8080"

on isUp(u)
	try
		do shell script "curl -s -o /dev/null --max-time 1 " & u
		return true
	on error
		return false
	end try
end isUp

on start(cmd, logFile)
	do shell script "nohup " & cmd & " > " & quoted form of logFile & " 2>&1 < /dev/null &"
end start

on openChat()
	if not isUp(modelURL) then start(quoted form of (base & "/.venv/bin/python") & " " & quoted form of (base & "/server.py"), base & "/server.log")
	if not isUp(ttsURL) then start(quoted form of (tts & "/.venv/bin/python") & " " & quoted form of (tts & "/server.py"), tts & "/server.log")
	if not isUp(theURL) then start(quoted form of (webui & "/start.sh"), webui & "/webui.log")
	repeat 240 times
		if isUp(modelURL) and isUp(theURL) then exit repeat
		delay 0.5
	end repeat
	open location theURL
end openChat

on run
	openChat()
end run

on reopen
	openChat()
end reopen

on quit
	try
		do shell script "curl -s -o /dev/null -X POST --max-time 2 " & modelURL & "/quit"
	end try
	try
		-- Anchored to our own copies' paths, so these cannot match a shell that merely mentions them.
		do shell script "pkill -f " & quoted form of ("^" & webui & "/.venv/bin/python .*open-webui serve")
	end try
	try
		do shell script "pkill -f " & quoted form of ("^" & tts & "/.venv/bin/python .*server.py")
	end try
	continue quit
end quit
