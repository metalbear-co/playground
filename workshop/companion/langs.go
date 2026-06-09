package main

// Lang describes one local backend variant and how an attendee runs it themselves.
type Lang struct {
	Name  string   // selector, e.g. "node"
	Bin   string   // executable that must be on PATH
	Dir   string   // subdir under backends/
	Watch string   // source file to watch for hot-reload
	Args  []string // args passed to Bin
	Files []string // files to copy into the attendee's flat working folder
	Pre   string   // a one-off setup step to print (e.g. npm install), or ""
}

// Ordered by preference for auto-selection. Node first — it's the only one that talks to the
// real cluster DB through mirrord (the fullest demo); the rest serve canned data.
var Langs = []Lang{
	{"node", "node", "node", "server.js", []string{"server.js"}, []string{"server.js", "package.json"}, "npm install"},
	{"python", "python3", "python", "server.py", []string{"server.py"}, []string{"server.py"}, ""},
	{"go", "go", "go", "main.go", []string{"run", "main.go"}, []string{"main.go", "go.mod"}, ""},
	{"java", "java", "java", "Server.java", []string{"Server.java"}, []string{"Server.java"}, ""},
	{"ruby", "ruby", "ruby", "server.rb", []string{"server.rb"}, []string{"server.rb"}, ""},
	{"dotnet", "dotnet", "dotnet", "Program.cs", []string{"run"}, []string{"Program.cs", "workshop-inventory.csproj"}, ""},
	{"php", "php", "php", "router.php", []string{"-S", "0.0.0.0:8080", "router.php"}, []string{"router.php"}, ""},
}

func langByName(name string) (Lang, bool) {
	for _, l := range Langs {
		if l.Name == name {
			return l, true
		}
	}
	return Lang{}, false
}

// mirrordCmd is the exact command the attendee runs themselves, in a second terminal.
func (l Lang) mirrordCmd() string {
	args := []string{"mirrord", "exec", "-f", "mirrord.json", "--", "sh", "reload.sh", l.Watch, l.Bin}
	args = append(args, l.Args...)
	return join(args)
}
