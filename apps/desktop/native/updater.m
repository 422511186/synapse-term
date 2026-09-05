#import <Cocoa/Cocoa.h>
#import <Sparkle/Sparkle.h>
#include <signal.h>
#include <unistd.h>

static NSString *const ReleaseBase = @"https://github.com/422511186/synapse-term/releases/download/v";

static void Emit(NSDictionary *message) {
  NSData *data = [NSJSONSerialization dataWithJSONObject:message options:0 error:nil];
  if (data != nil) {
    fwrite(data.bytes, 1, data.length, stdout);
    fputc('\n', stdout);
    fflush(stdout);
  }
}

@interface SynapseUpdater : NSObject <SPUUserDriver, SPUUpdaterDelegate>
@property(nonatomic, strong) SPUUpdater *updater;
@property(nonatomic, strong) NSBundle *host;
@property(nonatomic, copy) NSString *version;
@property(nonatomic, copy) NSString *expectedSignature;
@property(nonatomic) uint64_t expectedLength;
@property(nonatomic, strong) NSDictionary *candidate;
@property(nonatomic) BOOL authorized;
@property(nonatomic) BOOL started;
@property(nonatomic) BOOL parentGone;
@property(nonatomic) BOOL installationStarted;
- (void)acceptCommand:(NSDictionary *)command;
- (void)fail;
@end

@implementation SynapseUpdater

- (void)fail {
  Emit(@{ @"type": @"error" });
  if (self.authorized && (self.parentGone || self.installationStarted)) {
    NSAlert *alert = [[NSAlert alloc] init];
    alert.messageText = @"Synapse Term update failed";
    alert.informativeText = @"Open Synapse Term to check the installed version, or download the installer from GitHub Releases. Ended Sessions cannot be restored.";
    [alert runModal];
  }
  exit(EXIT_FAILURE);
}

- (NSString *)feedURLStringForUpdater:(SPUUpdater *)updater {
  return [NSString stringWithFormat:@"%@%@/appcast.xml", ReleaseBase, self.version];
}

- (BOOL)updaterShouldPromptForPermissionToCheckForUpdates:(SPUUpdater *)updater { return NO; }
- (NSSet<NSString *> *)allowedChannelsForUpdater:(SPUUpdater *)updater { return [NSSet set]; }
- (BOOL)updater:(SPUUpdater *)updater shouldDownloadReleaseNotesForUpdate:(SUAppcastItem *)item { return NO; }

- (NSDictionary *)metadataForItem:(SUAppcastItem *)item {
  NSString *url = [NSString stringWithFormat:@"%@%@/Synapse-Term-%@-arm64.dmg", ReleaseBase, self.version, self.version];
  id enclosure = item.propertiesDictionary[@"enclosure"];
  id signature = [enclosure isKindOfClass:[NSDictionary class]] ? enclosure[@"sparkle:edSignature"] : nil;
  id publicKey = self.host.infoDictionary[@"SUPublicEDKey"];
  if (![item.versionString isEqualToString:self.version] || ![item.fileURL.absoluteString isEqualToString:url] ||
      ![signature isKindOfClass:[NSString class]] || ![publicKey isKindOfClass:[NSString class]] ||
      [[[NSData alloc] initWithBase64EncodedString:signature options:0] length] != 64 ||
      [[[NSData alloc] initWithBase64EncodedString:publicKey options:0] length] != 32 ||
      !item.isMacOsUpdate || item.isInformationOnlyUpdate || item.isDeltaUpdate ||
      ![item.installationType isEqualToString:@"application"] || item.contentLength == 0 ||
      item.contentLength > 512ULL * 1024 * 1024) return nil;
  if (self.authorized && (![signature isEqualToString:self.expectedSignature] || item.contentLength != self.expectedLength)) return nil;
  return @{ @"type": @"candidate", @"version": item.versionString, @"url": url,
            @"length": @(item.contentLength), @"signature": signature, @"publicKey": publicKey };
}

- (BOOL)updater:(SPUUpdater *)updater shouldProceedWithUpdate:(SUAppcastItem *)item updateCheck:(SPUUpdateCheck)check error:(NSError **)error {
  if ([self metadataForItem:item] != nil) return YES;
  if (error != NULL) *error = [NSError errorWithDomain:@"SynapseUpdater" code:1
    userInfo:@{ NSLocalizedDescriptionKey: @"The update does not match the selected release." }];
  return NO;
}

- (void)updater:(SPUUpdater *)updater didFindValidUpdate:(SUAppcastItem *)item {
  self.candidate = [self metadataForItem:item];
}

- (void)updater:(SPUUpdater *)updater didFinishUpdateCycleForUpdateCheck:(SPUUpdateCheck)check error:(NSError *)error {
  if (self.authorized) {
    if (error != nil) [self fail];
    return;
  }
  if (error != nil && !([error.domain isEqualToString:SUSparkleErrorDomain] && error.code == SUNoUpdateError)) [self fail];
  Emit(self.candidate ?: @{ @"type": @"none" });
  exit(EXIT_SUCCESS);
}

- (void)acceptCommand:(NSDictionary *)command {
  if (self.started) { [self fail]; return; }
  self.started = YES;
  id version = command[@"version"];
  id action = command[@"command"];
  NSRegularExpression *pattern = [NSRegularExpression regularExpressionWithPattern:@"^(0|[1-9][0-9]*)\\.(0|[1-9][0-9]*)\\.(0|[1-9][0-9]*)$" options:0 error:nil];
  if (![version isKindOfClass:[NSString class]] || [version length] > 64 ||
      [pattern numberOfMatchesInString:version options:0 range:NSMakeRange(0, [version length])] != 1 ||
      (![action isEqual:@"check"] && ![action isEqual:@"prepare"] && ![action isEqual:@"install"])) { [self fail]; return; }
  self.version = version;
  self.authorized = [action isEqual:@"install"];
  BOOL preparing = [action isEqual:@"prepare"];
  NSSet *keys = [NSSet setWithArray:command.allKeys];
  NSSet *allowed = (self.authorized || preparing) ? [NSSet setWithArray:@[@"command", @"version", @"signature", @"length"]] : [NSSet setWithArray:@[@"command", @"version"]];
  if (![keys isEqualToSet:allowed]) { [self fail]; return; }
  if (self.authorized || preparing) {
    id signature = command[@"signature"];
    id length = command[@"length"];
    if (![signature isKindOfClass:[NSString class]] || [[[NSData alloc] initWithBase64EncodedString:signature options:0] length] != 64 ||
        ![length isKindOfClass:[NSNumber class]] || [length unsignedLongLongValue] == 0 ||
        [length unsignedLongLongValue] > 512ULL * 1024 * 1024) { [self fail]; return; }
    self.expectedSignature = signature;
    self.expectedLength = [length unsignedLongLongValue];
  }
  NSURL *hostURL = NSBundle.mainBundle.bundleURL.URLByDeletingLastPathComponent.URLByDeletingLastPathComponent.URLByDeletingLastPathComponent;
  self.host = [NSBundle bundleWithURL:hostURL];
  if (![self.host.bundleIdentifier isEqualToString:@"com.synapseterm.desktop"]) { [self fail]; return; }
  if (preparing) {
    NSNumber *readOnly = nil;
    if (![hostURL getResourceValue:&readOnly forKey:NSURLVolumeIsReadOnlyKey error:nil] || readOnly == nil || readOnly.boolValue) {
      [self fail]; return;
    }
    Emit(@{ @"type": @"prepared" });
    exit(EXIT_SUCCESS);
  }
  self.updater = [[SPUUpdater alloc] initWithHostBundle:self.host applicationBundle:self.host userDriver:self delegate:self];
  // Main owns scheduling. No native download or installation starts in check mode.
  self.updater.automaticallyChecksForUpdates = NO;
  self.updater.automaticallyDownloadsUpdates = NO;
  self.updater.sendsSystemProfile = NO;
  NSError *error = nil;
  if (![self.updater startUpdater:&error]) { [self fail]; return; }
  if (self.authorized) [self.updater checkForUpdates];
  else [self.updater checkForUpdateInformation];
}

- (void)showUpdatePermissionRequest:(SPUUpdatePermissionRequest *)request reply:(void (^)(SUUpdatePermissionResponse *))reply {
  reply([[SUUpdatePermissionResponse alloc] initWithAutomaticUpdateChecks:NO automaticUpdateDownloading:@NO sendSystemProfile:NO]);
}
- (void)showUserInitiatedUpdateCheckWithCancellation:(void (^)(void))cancellation {}
- (void)showUpdateFoundWithAppcastItem:(SUAppcastItem *)item state:(SPUUserUpdateState *)state reply:(void (^)(SPUUserUpdateChoice))reply {
  if (!self.authorized || [self metadataForItem:item] == nil) { reply(SPUUserUpdateChoiceSkip); [self fail]; return; }
  reply(SPUUserUpdateChoiceInstall);
}
- (void)showUpdateReleaseNotesWithDownloadData:(SPUDownloadData *)data {}
- (void)showUpdateReleaseNotesFailedToDownloadWithError:(NSError *)error {}
- (void)showUpdateNotFoundWithError:(NSError *)error acknowledgement:(void (^)(void))acknowledgement {
  acknowledgement();
  [self fail];
}
- (void)showUpdaterError:(NSError *)error acknowledgement:(void (^)(void))acknowledgement {
  acknowledgement();
  [self fail];
}
- (void)showDownloadInitiatedWithCancellation:(void (^)(void))cancellation {
  if (!self.authorized) { cancellation(); [self fail]; }
}
- (void)showDownloadDidReceiveExpectedContentLength:(uint64_t)length {}
- (void)showDownloadDidReceiveDataOfLength:(uint64_t)length {}
- (void)showDownloadDidStartExtractingUpdate { if (!self.authorized) [self fail]; }
- (void)showExtractionReceivedProgress:(double)progress {}
- (void)showReadyToInstallAndRelaunch:(void (^)(SPUUserUpdateChoice))reply {
  if (!self.authorized) { reply(SPUUserUpdateChoiceSkip); [self fail]; return; }
  reply(SPUUserUpdateChoiceInstall);
}
- (void)showInstallingUpdateWithApplicationTerminated:(BOOL)terminated retryTerminatingApplication:(void (^)(void))retry {
  if (!self.authorized) { [self fail]; return; }
  self.installationStarted = YES;
  Emit(@{ @"type": @"installing" });
}
- (void)showUpdateInstalledAndRelaunched:(BOOL)relaunched acknowledgement:(void (^)(void))acknowledgement {
  acknowledgement();
  if (!relaunched) [self fail];
  exit(EXIT_SUCCESS);
}
- (void)dismissUpdateInstallation {}
@end

int main(void) {
  @autoreleasepool {
    signal(SIGPIPE, SIG_IGN);
    [NSApplication sharedApplication];
    [NSApp setActivationPolicy:NSApplicationActivationPolicyAccessory];
    SynapseUpdater *driver = [[SynapseUpdater alloc] init];
    dispatch_async(dispatch_get_global_queue(QOS_CLASS_USER_INITIATED, 0), ^{
      char buffer[4096];
      if (fgets(buffer, sizeof(buffer), stdin) == NULL) exit(EXIT_FAILURE);
      NSData *data = [[NSString stringWithUTF8String:buffer] dataUsingEncoding:NSUTF8StringEncoding];
      id command = data == nil ? nil : [NSJSONSerialization JSONObjectWithData:data options:0 error:nil];
      dispatch_async(dispatch_get_main_queue(), ^{
        if (![command isKindOfClass:[NSDictionary class]]) [driver fail];
        else [driver acceptCommand:command];
      });
      // EOF before authorization cannot leave a Sparkle installer waiting on the app.
      while (fgets(buffer, sizeof(buffer), stdin) != NULL) {
        dispatch_async(dispatch_get_main_queue(), ^{ [driver fail]; });
      }
      dispatch_async(dispatch_get_main_queue(), ^{
        driver.parentGone = YES;
        if (!driver.authorized) exit(EXIT_SUCCESS);
      });
    });
    [NSApp run];
  }
  return EXIT_SUCCESS;
}
