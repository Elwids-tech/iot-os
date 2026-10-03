package rules

// SpatialCondition reuses the v1 polygon validation and uncertainty semantics.
// It has no evaluator state and makes no changes to v1 execution.
func SpatialCondition(p Polygon, longitude, latitude, uncertainty float64) (string, error) {
	g, err := compilePolygon(p)
	if err != nil {
		return "unknown", err
	}
	if !finite(longitude) || !finite(latitude) || !finite(uncertainty) || uncertainty < 0 || latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180 {
		return "unknown", nil
	}
	return g.classify(longitude, latitude, uncertainty), nil
}
