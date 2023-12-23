package main

import "syscall/js"

func main() {
	js.Global().Set("export1", "Hello!")
	<- make(chan bool)
}

