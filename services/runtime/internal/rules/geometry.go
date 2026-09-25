package rules

import (
	"fmt"
	"math"
)

// Polygon follows GeoJSON axis order: longitude, latitude. v1 supports a single
// closed simple ring in a local area; holes and dateline/polar geometry are rejected.
type Polygon struct {
	Type        string         `json:"type"`
	Coordinates [][][2]float64 `json:"coordinates"`
}

type xy struct{ x, y float64 }
type geometry struct {
	ring                []xy
	longitude, latitude float64
}

const earthRadius = 6371008.8
const radians = math.Pi / 180
const epsilon = 1e-7 // metres in the local projection

func finite(n float64) bool { return !math.IsNaN(n) && !math.IsInf(n, 0) }
func (g geometry) project(longitude, latitude float64) xy {
	delta := math.Remainder(longitude-g.longitude, 360)
	return xy{earthRadius * delta * radians * math.Cos(g.latitude*radians), earthRadius * (latitude - g.latitude) * radians}
}
func cross(a, b, c xy) float64 { return (b.x-a.x)*(c.y-a.y) - (b.y-a.y)*(c.x-a.x) }
func distance(a, b, p xy) float64 {
	dx, dy := b.x-a.x, b.y-a.y
	t := ((p.x-a.x)*dx + (p.y-a.y)*dy) / (dx*dx + dy*dy)
	t = math.Max(0, math.Min(1, t))
	return math.Hypot(p.x-(a.x+t*dx), p.y-(a.y+t*dy))
}
func intersects(a, b, c, d xy) bool {
	x, y, z, w := cross(a, b, c), cross(a, b, d), cross(c, d, a), cross(c, d, b)
	if ((x > 0 && y < 0) || (x < 0 && y > 0)) && ((z > 0 && w < 0) || (z < 0 && w > 0)) {
		return true
	}
	return distance(a, b, c) <= epsilon || distance(a, b, d) <= epsilon || distance(c, d, a) <= epsilon || distance(c, d, b) <= epsilon
}

func compilePolygon(p Polygon) (geometry, error) {
	if p.Type != "Polygon" || len(p.Coordinates) != 1 {
		return geometry{}, fmt.Errorf("v1 requires one Polygon ring without holes")
	}
	ring := p.Coordinates[0]
	if len(ring) < 4 || len(ring) > 257 || ring[0] != ring[len(ring)-1] {
		return geometry{}, fmt.Errorf("polygon must be closed with 3–256 vertices")
	}
	minLon, maxLon, minLat, maxLat := 180.0, -180.0, 90.0, -90.0
	seen := map[[2]float64]bool{}
	for _, p := range ring[:len(ring)-1] {
		if !finite(p[0]) || !finite(p[1]) || p[0] < -180 || p[0] > 180 || math.Abs(p[1]) > 75 {
			return geometry{}, fmt.Errorf("unsupported coordinate: v1 excludes polar geometry")
		}
		if seen[p] {
			return geometry{}, fmt.Errorf("repeated polygon vertex")
		}
		seen[p] = true
		minLon = math.Min(minLon, p[0])
		maxLon = math.Max(maxLon, p[0])
		minLat = math.Min(minLat, p[1])
		maxLat = math.Max(maxLat, p[1])
	}
	if maxLon-minLon > 1 || maxLat-minLat > 1 {
		return geometry{}, fmt.Errorf("v1 polygon extent must not exceed one degree or cross the dateline")
	}
	g := geometry{longitude: (minLon + maxLon) / 2, latitude: (minLat + maxLat) / 2}
	for _, p := range ring {
		g.ring = append(g.ring, g.project(p[0], p[1]))
	}
	area := 0.0
	n := len(g.ring) - 1
	for i := 0; i < n; i++ {
		a, b := g.ring[i], g.ring[i+1]
		if math.Hypot(b.x-a.x, b.y-a.y) < 0.01 {
			return geometry{}, fmt.Errorf("polygon edges must be at least one centimetre")
		}
		area += a.x*b.y - b.x*a.y
		// Adjacent edges may meet, but must not overlap by doubling back.
		c := g.ring[(i+2)%n]
		if distance(a, b, c) <= epsilon || distance(b, c, a) <= epsilon {
			return geometry{}, fmt.Errorf("overlapping adjacent polygon edges")
		}
		for j := i + 1; j < n; j++ {
			if j == i+1 || (i == 0 && j == n-1) {
				continue
			}
			if intersects(a, b, g.ring[j], g.ring[j+1]) {
				return geometry{}, fmt.Errorf("self-intersecting polygon")
			}
		}
	}
	if math.Abs(area) < 2 {
		return geometry{}, fmt.Errorf("polygon area must be at least one square metre")
	}
	return g, nil
}

func (g geometry) classify(longitude, latitude, uncertainty float64) string {
	p := g.project(longitude, latitude)
	inside := false
	nearest := math.Inf(1)
	for i := 0; i < len(g.ring)-1; i++ {
		a, b := g.ring[i], g.ring[i+1]
		nearest = math.Min(nearest, distance(a, b, p))
		if (a.y > p.y) != (b.y > p.y) && p.x < (b.x-a.x)*(p.y-a.y)/(b.y-a.y)+a.x {
			inside = !inside
		}
	}
	if uncertainty > 0 && nearest <= uncertainty {
		return "unknown"
	}
	if nearest <= epsilon || inside {
		return "inside"
	}
	return "outside"
}
