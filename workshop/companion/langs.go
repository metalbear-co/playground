package main

// Lang describes one local backend variant and how to run it.
type Lang struct {
	Name  string   // selector, e.g. "node"
	Bin   string   // executable that must be on PATH
	Dir   string   // subdir under backends/
	Watch string   // source file to watch for hot-reload
	Args  []string // args passed to Bin
}

// Ordered by preference for auto-selection. Node first — it's the only one that talks to the
// real cluster DB through mirrord (the fullest demo); the rest serve canned data.
var Langs = []Lang{
	{"node", "node", "node", "server.js", []string{"server.js"}},
	{"python", "python3", "python", "server.py", []string{"server.py"}},
	{"go", "go", "go", "main.go", []string{"run", "main.go"}},
	{"java", "java", "java", "Server.java", []string{"Server.java"}},
	{"ruby", "ruby", "ruby", "server.rb", []string{"server.rb"}},
	{"dotnet", "dotnet", "dotnet", "Program.cs", []string{"run"}},
	{"php", "php", "php", "router.php", []string{"-S", "0.0.0.0:8080", "router.php"}},
}

func langByName(name string) (Lang, bool) {
	for _, l := range Langs {
		if l.Name == name {
			return l, true
		}
	}
	return Lang{}, false
}
