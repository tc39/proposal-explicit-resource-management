const del = require("del");
const path = require("path");
const gulp = require("gulp");
const emu = require("gulp-emu");
const rename = require("gulp-rename");
const gls = require("gulp-live-server");

gulp.task("clean", () => del("docs/**/*"));

gulp.task("build", () => gulp
    .src(["spec.emu"])
    .pipe(emu())
    .pipe(rename("index.html"))
    .pipe(gulp.dest("docs")));

gulp.task("watch", () => gulp
    .watch(["spec.emu"], gulp.task("build")));

gulp.task("start", gulp.parallel("watch", () => {
    const server = gls.static("docs", 8080);
    const promise = server.start();
    (/** @type {import("chokidar").FSWatcher}*/(gulp.watch(["docs/**/*"])))
        .on("change", file => {
            server.notify({ path: path.resolve(file) });
        });
    return promise;
}));

gulp.task("default", gulp.task("build"));