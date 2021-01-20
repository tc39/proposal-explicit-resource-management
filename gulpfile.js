const del = require("del");
const path = require("path");
const gulp = require("gulp");
const emu = require("gulp-emu");
const gls = require("gulp-live-server");

const clean = () => del("docs/**/*");
gulp.task("clean", clean);

const build = () => gulp
    .src(["spec/index.html"])
    .pipe(emu())
    .pipe(gulp.dest("docs"));
gulp.task("build", build);

const watch = () => gulp
    .watch(["spec/**/*"], build);
gulp.task("watch", watch);

const serve = () => {
    const server = gls.static("docs", 8080);
    const promise = server.start();
    (/** @type {import("chokidar").FSWatcher}*/(gulp.watch(["docs/**/*"])))
        .on("change", file => {
            server.notify({ path: path.resolve(file) });
        });
    return promise;
};
gulp.task("start", gulp.parallel(watch, serve));
gulp.task("default", build);