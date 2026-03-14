// Boundary wrap/bounce/despawn shader.
// Supports all three topologies: Torus, Klein bottle, RP² (real projective plane).
// Klein/RP² glide reflections flip velocities and angular velocity on axis crossing.

@group(0) @binding(0) var<uniform> uniforms: SimUniforms;
@group(0) @binding(1) var<storage, read_write> posX: array<f32>;
@group(0) @binding(2) var<storage, read_write> posY: array<f32>;
@group(0) @binding(3) var<storage, read_write> velWX: array<f32>;
@group(0) @binding(4) var<storage, read_write> velWY: array<f32>;
@group(0) @binding(5) var<storage, read_write> flags: array<u32>;
@group(0) @binding(6) var<storage, read_write> angW: array<f32>;

@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
    let idx = gid.x;
    if (idx >= uniforms.aliveCount) { return; }

    let flag = flags[idx];
    if ((flag & FLAG_ALIVE) == 0u) { return; }

    var x = posX[idx];
    var y = posY[idx];
    let w = uniforms.domainW;
    let h = uniforms.domainH;

    if (uniforms.boundaryMode == BOUND_LOOP) {
        let topo = uniforms.topologyMode;

        if (topo == TOPO_TORUS) {
            // Torus: simple periodic wrap on both axes
            if (x < 0.0) { x += w; }
            else if (x >= w) { x -= w; }
            if (y < 0.0) { y += h; }
            else if (y >= h) { y -= h; }
            posX[idx] = x;
            posY[idx] = y;

        } else if (topo == TOPO_KLEIN) {
            // Klein bottle: x is periodic, y-wrap is a glide reflection
            // y crossing mirrors x-position and negates x-velocity + angular velocity
            if (x < 0.0) { x += w; }
            else if (x >= w) { x -= w; }
            if (y < 0.0) {
                y += h;
                x = w - x;
                velWX[idx] = -velWX[idx];
                angW[idx] = -angW[idx];
            } else if (y >= h) {
                y -= h;
                x = w - x;
                velWX[idx] = -velWX[idx];
                angW[idx] = -angW[idx];
            }
            posX[idx] = x;
            posY[idx] = y;

        } else {
            // RP² (real projective plane): both axes carry glide reflections
            // x crossing flips y-position and negates y-velocity + angular velocity
            // y crossing flips x-position and negates x-velocity + angular velocity
            var vx = velWX[idx];
            var vy = velWY[idx];
            var aw = angW[idx];

            if (x < 0.0) {
                x += w;
                y = h - y;
                vy = -vy;
                aw = -aw;
            } else if (x >= w) {
                x -= w;
                y = h - y;
                vy = -vy;
                aw = -aw;
            }
            if (y < 0.0) {
                y += h;
                x = w - x;
                vx = -vx;
                aw = -aw;
            } else if (y >= h) {
                y -= h;
                x = w - x;
                vx = -vx;
                aw = -aw;
            }

            posX[idx] = x;
            posY[idx] = y;
            velWX[idx] = vx;
            velWY[idx] = vy;
            angW[idx] = aw;
        }

    } else if (uniforms.boundaryMode == BOUND_BOUNCE) {
        var vx = velWX[idx];
        var vy = velWY[idx];
        if (x < 0.0) { x = -x; vx = abs(vx); }
        else if (x >= w) { x = 2.0 * w - x; vx = -abs(vx); }
        if (y < 0.0) { y = -y; vy = abs(vy); }
        else if (y >= h) { y = 2.0 * h - y; vy = -abs(vy); }
        posX[idx] = x;
        posY[idx] = y;
        velWX[idx] = vx;
        velWY[idx] = vy;

    } else {
        // Despawn: mark particles outside domain as dead
        if (x < 0.0 || x >= w || y < 0.0 || y >= h) {
            flags[idx] = flag & ~FLAG_ALIVE;
        }
    }
}
