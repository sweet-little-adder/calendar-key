/*
 * Spawn a child that is responsible for its own TCC permission prompts.
 * Stream Deck plugins inherit Stream Deck as the TCC "responsible" process,
 * which blocks Calendar access (Stream Deck lacks the calendars entitlement).
 * responsibility_spawnattrs_setdisclaim makes the child responsible instead.
 */
#include <errno.h>
#include <spawn.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/wait.h>
#include <unistd.h>

/* Private SPI present on modern macOS. */
int responsibility_spawnattrs_setdisclaim(posix_spawnattr_t *attrs, int disclaim);

extern char **environ;

int main(int argc, char *argv[]) {
	if (argc < 2) {
		fprintf(stderr, "usage: disclaim-spawn <program> [args...]\n");
		return 2;
	}

	posix_spawnattr_t attr;
	int err = posix_spawnattr_init(&attr);
	if (err != 0) {
		fprintf(stderr, "posix_spawnattr_init: %s\n", strerror(err));
		return 1;
	}

	err = responsibility_spawnattrs_setdisclaim(&attr, 1);
	if (err != 0) {
		/* Fall through without disclaim rather than failing hard on older OS. */
		fprintf(stderr, "responsibility_spawnattrs_setdisclaim: %s\n", strerror(err));
	}

	pid_t pid = 0;
	err = posix_spawn(&pid, argv[1], NULL, &attr, &argv[1], environ);
	posix_spawnattr_destroy(&attr);

	if (err != 0) {
		fprintf(stderr, "posix_spawn(%s): %s\n", argv[1], strerror(err));
		return 1;
	}

	int status = 0;
	if (waitpid(pid, &status, 0) < 0) {
		perror("waitpid");
		return 1;
	}

	if (WIFEXITED(status)) {
		return WEXITSTATUS(status);
	}
	if (WIFSIGNALED(status)) {
		return 128 + WTERMSIG(status);
	}
	return 1;
}
