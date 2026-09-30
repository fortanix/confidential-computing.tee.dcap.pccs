#
# Copyright(c) 2025 Intel Corporation
# SPDX-License-Identifier: BSD-3-Clause
#

include installConfig

PACKAGE_ROOT_FOLDER=pkgroot
PACKAGES=$(notdir $(wildcard $(PACKAGE_ROOT_FOLDER)/*))


default:

install: $(PACKAGES)


$(PACKAGES):
	install -d $(shell readlink -m $(DESTDIR)/$(PCCS_ADMIN_PACKAGE_PATH)/$(PCCS_ADMIN_PACKAGE_INSTALL_DIR_NAME))
	cp -r $(PACKAGE_ROOT_FOLDER)/$@/* $(DESTDIR)/$(PCCS_ADMIN_PACKAGE_PATH)/$(PCCS_ADMIN_PACKAGE_INSTALL_DIR_NAME)
