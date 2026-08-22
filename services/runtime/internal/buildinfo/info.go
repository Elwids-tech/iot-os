package buildinfo

var (
	Version = "dev"
	Commit  = "unknown"
)

type Info struct {
	Version string `json:"version"`
	Commit  string `json:"commit"`
}

func Current() Info {
	return Info{
		Version: Version,
		Commit:  Commit,
	}
}
