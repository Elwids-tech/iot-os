package rules

import (
	"math"
	"testing"
)

func TestMembershipBoundaryAndUncertainty(t *testing.T) {
	f := fixture(t)
	g, err := compilePolygon(f.Definition.Geometry)
	if err != nil {
		t.Fatal(err)
	}
	for _, c := range []struct {
		lon, lat, band float64
		want           string
	}{
		{-114, 51, 0, "inside"}, {-114, 51.02, 5, "outside"},
		{-114, 51.01, 0, "inside"}, {-114, 51.01, 5, "unknown"},
		{-114, 51.00999, 5, "unknown"}, {-114, 51.01001, 5, "unknown"},
	} {
		if got := g.classify(c.lon, c.lat, c.band); got != c.want {
			t.Fatalf("%+v => %s", c, got)
		}
	}
	// Reversing winding does not change membership.
	ring := f.Definition.Geometry.Coordinates[0]
	for i, j := 0, len(ring)-1; i < j; i, j = i+1, j-1 {
		ring[i], ring[j] = ring[j], ring[i]
	}
	reversed, err := compilePolygon(f.Definition.Geometry)
	if err != nil {
		t.Fatal(err)
	}
	if reversed.classify(-114, 51, 0) != "inside" {
		t.Fatal("winding changed membership")
	}
	for i := range ring {
		ring[i][0] += 293.5
	}
	nearDateLine, err := compilePolygon(f.Definition.Geometry)
	if err != nil {
		t.Fatal(err)
	}
	if nearDateLine.classify(-179.99, 51, 100000) != "unknown" {
		t.Fatal("nearby point across dateline used the long distance")
	}
}
func TestInvalidPolygonAndPolicies(t *testing.T) {
	for _, mutate := range []func(*Definition){
		func(d *Definition) {
			d.Geometry.Coordinates = append(d.Geometry.Coordinates, d.Geometry.Coordinates[0])
		},
		func(d *Definition) { d.Geometry.Coordinates[0][0][0] = math.NaN() },
		func(d *Definition) {
			d.Geometry.Coordinates[0] = [][2]float64{{0, 0}, {.01, .01}, {0, .01}, {.01, 0}, {0, 0}}
		},
		func(d *Definition) {
			d.Geometry.Coordinates[0] = [][2]float64{{0, 0}, {.02, 0}, {.01, 0}, {.01, .01}, {0, 0}}
		},
		func(d *Definition) {
			d.Geometry.Coordinates[0] = [][2]float64{{179, 0}, {-179, 0}, {-179, 1}, {179, 0}}
		},
		func(d *Definition) {
			d.Geometry.Coordinates[0] = [][2]float64{{0, 80}, {.01, 80}, {.01, 80.01}, {0, 80}}
		},
		func(d *Definition) { d.Geometry.Coordinates[0] = [][2]float64{{0, 0}, {.01, 0}, {.02, 0}, {0, 0}} },
		func(d *Definition) { d.Policy.MinimumSamples = 1 },
		func(d *Definition) { d.Policy.MaxGapSeconds = d.Binding.MaxAgeSeconds + 1 },
		func(d *Definition) { d.Policy.UncertaintyMetres = math.Inf(1) },
		func(d *Definition) { d.Pipeline[1] = "arbitrary-script" },
	} {
		f := fixture(t)
		mutate(&f.Definition)
		if _, err := Compile(f.Definition); err == nil {
			t.Fatal("invalid definition accepted", f.Definition)
		}
	}
}
