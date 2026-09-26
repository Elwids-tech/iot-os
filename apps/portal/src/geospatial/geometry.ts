export function closeRing(vertices: number[][]): number[][] {
  if (vertices.length < 3) return vertices
  const first = vertices[0], last = vertices.at(-1)
  return last?.[0] === first[0] && last?.[1] === first[1] ? vertices : [...vertices, [...first]]
}

export function validateVertices(vertices: number[][]): string | null {
  if (vertices.length < 3) return "Add at least three points."
  if (vertices.length > 256) return "Use no more than 256 points."
  if (vertices.some((point) => point.length !== 2 || !Number.isFinite(point[0]) || !Number.isFinite(point[1]) || Math.abs(point[0]) > 180 || Math.abs(point[1]) > 75)) return "Every point must contain valid longitude and latitude coordinates."
  if (new Set(vertices.map((point) => `${point[0]}:${point[1]}`)).size !== vertices.length) return "Remove repeated points."
  const longitudes = vertices.map((point) => point[0]), latitudes = vertices.map((point) => point[1])
  if (Math.max(...longitudes) - Math.min(...longitudes) > 1 || Math.max(...latitudes) - Math.min(...latitudes) > 1) return "The polygon must span no more than one degree of longitude or latitude."
  const projected = projectVertices(vertices)
  for (let index = 0; index < projected.length; index++) {
    const next = projected[(index + 1) % projected.length]
    if (Math.hypot(next[0] - projected[index][0], next[1] - projected[index][1]) < 0.01) return `Edge ${index + 1} must be at least one centimetre long.`
  }
  for (let a = 0; a < vertices.length; a++) for (let b = a + 1; b < vertices.length; b++) {
    if (Math.abs(a - b) <= 1 || (a === 0 && b === vertices.length - 1)) continue
    if (segmentsIntersect(vertices[a], vertices[(a + 1) % vertices.length], vertices[b], vertices[(b + 1) % vertices.length])) return `Edges ${a + 1} and ${b + 1} cross.`
  }
  const twiceArea = projected.reduce((area, point, index) => { const next = projected[(index + 1) % projected.length]; return area + point[0] * next[1] - next[0] * point[1] }, 0)
  if (Math.abs(twiceArea) < 2) return "The polygon area must be at least one square metre."
  return null
}

function segmentsIntersect(a: number[], b: number[], c: number[], d: number[]) {
  const turn = (p: number[], q: number[], r: number[]) => (q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0])
  return turn(a, b, c) * turn(a, b, d) < 0 && turn(c, d, a) * turn(c, d, b) < 0
}

function projectVertices(vertices: number[][]): number[][] {
  const longitude = (Math.min(...vertices.map((point) => point[0])) + Math.max(...vertices.map((point) => point[0]))) / 2
  const latitude = (Math.min(...vertices.map((point) => point[1])) + Math.max(...vertices.map((point) => point[1]))) / 2
  const radians = Math.PI / 180, radius = 6_371_008.8
  return vertices.map((point) => [radius * (point[0] - longitude) * radians * Math.cos(latitude * radians), radius * (point[1] - latitude) * radians])
}
